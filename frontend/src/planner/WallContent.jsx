// 後台「大螢幕」的「內容」分頁（WallHub 裡）：大螢幕要放哪些東西，新人自己選。
// 大螢幕要放什麼新人自己選（2026-10-03）：逐字歌詞的 MV、只要音樂和祝福、不要賓客留言、放照片和註解……
// 不做成幾種固定的「模式」，而是幾樣可以各自開關的內容（歌詞、賓客留言、照片），上面再給幾個常見的組合一鍵套用。
// 設定存在 wall_content（走 /api/planner/wall/content），大螢幕下一次問 feed 就照新的排，當天切換幾秒內就看得到。
// 兩把鑰匙都能改：婚禮前新人在這裡選，當天幫手也能切（例如進場時只放照片、用餐時打開留言）。
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Images, Layers, MessageSquareHeart, Music, Type } from "lucide-react";
import { fetchThumbBlobUrl, fetchWallContent, fetchWallPhotos, fetchWallScenes, saveWallAlbum, saveWallContent } from "../api.js";
import Toggle from "../components/Toggle.jsx";
import { ErrorBox, Loading, toastErr, useLoader } from "./ui.jsx";

// 常見的組合：新人多半從這裡挑一個，再到下面細調
export const PRESETS = [
  { key: "mv", label: "歌詞 MV", hint: "音樂、逐字歌詞、賓客留言", set: { lyrics: true, messages: true, photos: false } },
  { key: "wishes", label: "祝福牆", hint: "音樂和賓客留言，不放歌詞", set: { lyrics: false, messages: true, photos: false } },
  { key: "photos", label: "照片回顧", hint: "音樂、照片和註解", set: { lyrics: false, messages: false, photos: true } },
  { key: "all", label: "全都要", hint: "照片、留言、歌詞都放，照片上也唱歌詞、放祝福", set: { lyrics: true, messages: true, photos: true } },
];
export const presetOf = (c) => PRESETS.find((p) => Object.entries(p.set).every(([k, v]) => c[k] === v))?.key || "";

// 照片與一般畫面的比例。照片的畫面也會唱歌詞、放祝福，所以「全放照片」就是整場照片 MV
// hint 的 w：一般畫面放的是什麼（開著留言就說留言，只開歌詞就說歌詞）；on：照片上放什麼
export const MIX = [
  ["all", "全放照片", (w, on) => `每一段都是照片，${on}放在照片上`],
  ["photos", "照片多", (w) => `兩段照片、一段${w}`],
  ["even", "一樣多", (w) => `照片和${w}輪流`],
  ["messages", "留言多", (w) => `一段照片、兩段${w}`],
];
const CAPTION_LONG = 40; // 大螢幕上一眼讀完的長度；超過的會提醒（太長的大螢幕會截斷）
const SMALL_PHOTO = 1200; // 跟大螢幕 photos.ts 一致：長邊不到這個數字算很小的舊照片

/** 要播的照片是哪幾種：大螢幕會依照片挑適合的版面（直的配直的相框、舊照片放小一點），讓新人知道自己的照片會怎麼放。 */
function kindSummary(items) {
  const n = { landscape: 0, portrait: 0, square: 0, small: 0, focus: 0 };
  for (const p of items) {
    if (p.fx != null) n.focus++;
    if (!p.w || !p.h) continue;
    const r = p.w / p.h;
    n[r > 1.15 ? "landscape" : r < 0.87 ? "portrait" : "square"]++;
    if (Math.max(p.w, p.h) < SMALL_PHOTO) n.small++;
  }
  const parts = [["landscape", "橫的"], ["portrait", "直的"], ["square", "方的"], ["small", "很小的舊照片"]].filter(([k]) => n[k]).map(([k, l]) => `${l} ${n[k]} 張`);
  return { text: parts.join("、"), focus: n.focus };
}

export default function WallContent() {
  const { data: content, setData: setContent, loading, error } = useLoader(fetchWallContent, []);
  const { data: photos, setData: setPhotos, reload: reloadPhotos } = useLoader(fetchWallPhotos, []);
  // 現在的場合有自己的「畫面放什麼」時，大螢幕照場合的放：這裡改的要等換到沒設畫面的場合才看得到，要說清楚
  const { data: scenes } = useLoader(fetchWallScenes, []);
  const [saving, setSaving] = useState(false);

  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  const save = async (values) => {
    setSaving(true);
    const before = content;
    setContent({ ...content, ...values }); // 先換畫面，開關才不會慢半拍
    try {
      setContent(await saveWallContent(values));
      if (values.photos) reloadPhotos();
    } catch (e) { setContent(before); toastErr(e); } finally { setSaving(false); }
  };
  // 一本相簿放不放大螢幕（跟婚紗照頁「這本相簿給誰看」同一份設定）
  const saveAlbum = async (album, wall) => {
    setSaving(true);
    try { setPhotos(await saveWallAlbum(album, wall)); } catch (e) { toastErr(e); } finally { setSaving(false); }
  };
  const preset = presetOf(content);
  const sceneNow = scenes?.items?.find((s) => s.id === scenes.active?.id && s.content);
  const albums = photos?.albums || [];
  const total = albums.reduce((n, a) => n + a.count, 0);

  return (
    <div>
      <div className="wall-tab-intro">
        <div className="pl-sub">先挑一個組合，再到下面細調。改了之後大螢幕幾秒內就會換，婚禮當天也能用「手機遙控」切換。進場、用餐想放不一樣的，到「場合」分頁替每個場合設定。</div>
      </div>
      {sceneNow && (
        <div className="wc-off-note">
          <span>大螢幕現在是「{sceneNow.name}」場合，畫面照那個場合的設定放。這裡是沒有指定場合、或場合沒設畫面時放的內容。</span>
          <span className="wc-off-acts"><Link to="/wall?tab=scenes" className="btn btn-ghost btn-sm">看「場合」設定</Link></span>
        </div>
      )}

      <div className="panel">
        <div className="panel-head"><div className="panel-title"><Layers size={18} /> 常見的組合</div></div>
        <div className="wp-pace">
          {PRESETS.map((p) => (
            <button key={p.key} type="button" disabled={saving} className={`btn ${preset === p.key ? "btn-primary" : "btn-ghost"}`}
              onClick={() => preset !== p.key && save(p.set)}>
              <span>{p.label}</span><small>{p.hint}</small>
            </button>
          ))}
        </div>
        {!preset && <p className="helper-text" style={{ marginBottom: 0 }}>現在是你們自己調的組合。</p>}
      </div>

      <div className="panel wc-items">
        <div className="panel-head"><div className="panel-title"><Music size={18} /> 要放的內容</div></div>
        <p className="helper-text" style={{ marginTop: 0 }}>音樂照「歌單」分頁播；畫面的風格在「版面」分頁挑。</p>

        <Item icon={<Type size={18} />} title="逐字歌詞" checked={content.lyrics} disabled={saving} onChange={(v) => save({ lyrics: v })}>
          歌詞跟著歌聲一個字一個字亮起來。關掉就只放音樂，歌單也不用花時間對歌詞。
        </Item>

        <Item icon={<MessageSquareHeart size={18} />} title="賓客祝福留言" checked={content.messages} disabled={saving} onChange={(v) => save({ messages: v })}>
          賓客掃 QR code 寫祝福，幾秒後上螢幕。
          {!content.messages && <div className="wc-note">
            關掉時畫面上沒有 QR code，賓客也不能留言。原本放留言的位置，會輪流放你們自己寫的話：
            到「<Link to="/wall">留言</Link>」分頁按「新增」寫幾句（建議 3 到 5 句，才不會一直重複）；一句都沒寫的話，會放幾句預設的感謝詞。
          </div>}
        </Item>

        <Item icon={<Images size={18} />} title="照片與註解" checked={content.photos} disabled={saving} onChange={(v) => save({ photos: v })}>
          放「婚紗照」頁上傳的照片，註解就是每張照片的「說明」。成長照、交往的生活照也可以，橫的直的、手機拍的都行；不想讓賓客在婚禮網站看到的，那本相簿設成「只放大螢幕」。
          打開歌詞時照片上也會跟著唱歌詞，打開留言時照片上也會放賓客的祝福。
          {content.photos && <Photos content={content} albums={albums} items={photos?.items || []} total={total} saving={saving} save={save} saveAlbum={saveAlbum} />}
        </Item>
      </div>
    </div>
  );
}

/**
 * 留言、歌單分頁上方的提醒：新人在「內容」關掉了賓客留言或歌詞，那一頁的東西暫時不會上大螢幕，要讓他們知道為什麼、怎麼打開。
 * 放在 WallHub（分頁內容的上面），不用改各分頁。
 */
export function ContentOffNote({ kind }) {
  const { data: c, setData } = useLoader(fetchWallContent, []);
  const [busy, setBusy] = useState(false);
  if (!c || c[kind]) return null;
  const turnOn = async () => {
    setBusy(true);
    try { setData(await saveWallContent({ [kind]: true })); } catch (e) { toastErr(e); } finally { setBusy(false); }
  };
  const text = kind === "messages"
    ? "大螢幕現在不放賓客留言：畫面上沒有 QR code，賓客也不能留言。你們在這裡新增的話，會輪流出現在大螢幕上。"
    : "大螢幕現在不放歌詞，這裡的歌詞可以先不用對；之後打開歌詞，就照這裡對好的顯示。";
  return (
    <div className="wc-off-note">
      <span>{text}</span>
      <span className="wc-off-acts">
        <Link to="/wall?tab=content" className="btn btn-ghost btn-sm">看「內容」設定</Link>
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={turnOn}>{kind === "messages" ? "打開賓客留言" : "打開歌詞"}</button>
      </span>
    </div>
  );
}

function Item({ icon, title, checked, disabled, onChange, children }) {
  return (
    <div className={`wc-item${checked ? "" : " off"}`}>
      <div className="wc-item-icon">{icon}</div>
      <div className="wc-item-body">
        <div className="wc-item-title">{title}</div>
        <div className="wc-item-text">{children}</div>
      </div>
      <Toggle checked={checked} disabled={disabled} onChange={onChange} label={title} />
    </div>
  );
}

function Photos({ content, albums, items, total, saving, save, saveAlbum }) {
  if (!total) {
    return <div className="wc-note">還沒有照片。到「<Link to="/photos">婚紗照</Link>」頁上傳：新增相簿時選「只放大螢幕」，生活照就不會出現在婚禮網站上。每張照片的「說明」就是大螢幕上的註解。</div>;
  }
  const count = albums.filter((a) => a.wall).reduce((n, a) => n + a.count, 0);
  const onCount = albums.filter((a) => a.wall).length;
  const onlyPhotos = !content.lyrics && !content.messages;
  const long = content.captions ? items.filter((p) => [...p.caption.trim()].length > CAPTION_LONG).length : 0;
  const kinds = kindSummary(items);
  return (
    <div className="wc-photos">
      <div className="wc-sub">要放的相簿 <span className="muted-cell">（{count} 張；照「婚紗照」頁的順序播，一本相簿就是一章）</span></div>
      <div className="wc-albums">
        {albums.map((a) => (
          <Album key={a.album} album={a} on={a.wall} disabled={saving || (onCount === 1 && a.wall)} onChange={(v) => saveAlbum(a.album, v)} />
        ))}
      </div>
      {kinds.text && <p className="helper-text">
        {kinds.text}。大螢幕會依照片挑適合的版面：直的放進直的相框、很小的舊照片不放滿版、暗的照片配亮的版面。
        {items.length > 0 && <> 臉不在照片中間的，到「<Link to="/photos">婚紗照</Link>」頁按照片的鉛筆、點一下臉設定焦點（已設定 {kinds.focus} 張）。</>}
      </p>}
      <label className="wall-msg-toggle wc-caption-toggle">
        <Toggle checked={content.captions} disabled={saving} onChange={(v) => save({ captions: v })} label="照片下面放註解" /> 照片下面放註解
      </label>
      {long > 0 && <p className="helper-text">有 {long} 張的註解超過 {CAPTION_LONG} 個字，大螢幕上不容易一眼讀完，建議到「婚紗照」頁改短一點。</p>}
      {(content.lyrics || content.messages) && <p className="helper-text">
        照片上的字：{content.messages ? "有註解的照片這一輪放註解、下一輪放一則賓客祝福，新的祝福一進來就先放上去" : "放照片的註解"}
        {content.lyrics ? "；歌詞在下面跟著唱。" : "。"}
      </p>}
      {onlyPhotos ? (
        <p className="helper-text">歌詞和留言都關著：整場都放照片。</p>
      ) : (
        <>
          <div className="wc-sub" style={{ marginTop: 12 }}>照片和{content.messages ? "留言" : "歌詞"}的比例</div>
          <div className="wp-pace wc-mix">
            {MIX.map(([k, label, hint]) => (
              <button key={k} type="button" disabled={saving} className={`btn btn-sm ${content.mix === k ? "btn-primary" : "btn-ghost"}`} onClick={() => content.mix !== k && save({ mix: k })}>
                <span>{k === "messages" && !content.messages ? "歌詞多" : label}</span>
                <small>{hint(content.messages ? "留言" : "歌詞", content.messages && content.lyrics ? "歌詞和留言" : content.messages ? "留言" : "歌詞")}</small>
              </button>
            ))}
          </div>
          {content.messages && <p className="helper-text">賓客的新留言一定先上螢幕，不用排在後面等（照片上也會放）。</p>}
        </>
      )}
    </div>
  );
}

function Album({ album, on, disabled, onChange }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let url = "";
    fetchThumbBlobUrl(album.cover_id).then((u) => { url = u; setSrc(u); }).catch(() => {});
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [album.cover_id]);
  const missing = album.count - album.captioned;
  const hint = useMemo(() => (missing === album.count ? "都還沒寫註解" : missing ? `${missing} 張沒有註解` : "每張都有註解"), [missing, album.count]);
  return (
    <div className={`wc-album${on ? "" : " off"}`}>
      <div className="wc-album-thumb">{src && <img src={src} alt="" />}</div>
      <div className="wc-album-body">
        <div className="wc-album-name">{album.album || "未分類"}</div>
        <div className="muted-cell">{album.count} 張 · {hint}</div>
        {!album.guests && <div className="muted-cell wc-album-private">賓客在網站上看不到</div>}
      </div>
      <Toggle checked={on} disabled={disabled} onChange={onChange} label={`放「${album.album || "未分類"}」`} />
    </div>
  );
}
