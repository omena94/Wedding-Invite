// 後台「大螢幕」（2026-10-01）：原本分散在側邊欄的「現場留言」「大螢幕版面」「大螢幕遙控」，加上藏在留言頁最下面的歌單，
// 合成一頁、用分頁切換（網址 ?tab=，重新整理或分享連結都會停在同一個分頁）。
// 鑰匙分兩把：wall＝當天操作（留言、遙控、開大螢幕），wall_setup＝歌單與版面；看不到的分頁直接不出現。
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Monitor, Smartphone } from "lucide-react";
import Wall, { RemoteQr } from "./Wall.jsx";
import WallSongs from "./WallSongs.jsx";
import WallContent, { ContentOffNote } from "./WallContent.jsx";
import WallPlates from "./WallPlates.jsx";
import WallScenes from "./WallScenes.jsx";
import WallRemote from "./WallRemote.jsx";
import { usePlanner } from "./context.js";
import { PageHead } from "./ui.jsx";

// 照婚禮當天最常用的順序排
const TABS = [
  { key: "messages", label: "留言", perm: "wall", sub: "賓客掃 QR code 到 /wish 留言，會即時出現在會場大螢幕上。大螢幕請用會場電腦登入後開啟。" },
  // 內容（2026-10-03）：放不放歌詞、賓客留言、照片。婚禮前新人選，當天幫手也能切，所以兩把鑰匙都看得到
  { key: "content", label: "內容", perm: ["wall", "wall_setup"], sub: "大螢幕要放什麼你們決定：逐字歌詞、賓客的祝福、照片和註解，可以只放其中幾樣。" },
  { key: "songs", label: "歌單", perm: "wall_setup", sub: "大螢幕播的歌：上傳音檔、對歌詞、排順序。大螢幕照這裡的順序播。" },
  { key: "plates", label: "版面", perm: "wall_setup", sub: "大螢幕的各種畫面：先預覽，不喜歡的關掉，也可以調整換版面的節奏。" },
  // 場合（2026-10-03）：當天流程（進場、用餐、敬酒…）各自的歌與畫面，婚禮前新人排好，當天在「遙控」切
  { key: "scenes", label: "場合", perm: "wall_setup", sub: "進場、用餐、敬酒各放什麼歌、什麼畫面，先排好；當天在「遙控」按一下就整組換過去。" },
  { key: "remote", label: "遙控", perm: "wall", sub: "用手機操作會場大螢幕：切歌、拖進度、插播、講話模式。按下去馬上生效（網路不穩時要等一兩秒）。" },
];

export default function WallHub() {
  const { can } = usePlanner();
  const [params, setParams] = useSearchParams();
  const [remoteQr, setRemoteQr] = useState(false);
  const tabs = TABS.filter((t) => can(...[].concat(t.perm)));
  const tab = tabs.find((t) => t.key === params.get("tab")) || tabs[0];
  if (!tab) return null;
  // 遙控分頁多半是手機在用，頁首的按鈕留給電腦上的其他分頁
  const actions = can("wall") && tab.key !== "remote" ? <>
    <button type="button" className="btn btn-ghost" onClick={() => setRemoteQr(true)}><Smartphone size={15} /> 手機遙控</button>
    <button type="button" className="btn btn-primary" onClick={() => window.open("/wall", "_blank", "noopener")}><Monitor size={15} /> 開啟大螢幕</button>
  </> : null;

  return (
    <div>
      <PageHead title="大螢幕" sub={tab.sub} actions={actions} />
      {tabs.length > 1 && (
        <div className="wall-tabs" role="group" aria-label="大螢幕功能分頁">
          {tabs.map((t) => (
            <button key={t.key} type="button" className={`btn ${t.key === tab.key ? "btn-primary" : "btn-ghost"}`} aria-pressed={t.key === tab.key}
              onClick={() => setParams(t.key === tabs[0].key ? {} : { tab: t.key })}>{t.label}</button>
          ))}
        </div>
      )}
      {(tab.key === "messages" || tab.key === "songs") && <ContentOffNote key={tab.key} kind={tab.key === "messages" ? "messages" : "lyrics"} />}
      {tab.key === "messages" && <Wall />}
      {tab.key === "content" && <WallContent />}
      {tab.key === "songs" && <WallSongs />}
      {tab.key === "plates" && <WallPlates />}
      {tab.key === "scenes" && <WallScenes />}
      {tab.key === "remote" && <WallRemote />}
      {remoteQr && <RemoteQr url={`${location.origin}/planner/wall?tab=remote`} onClose={() => setRemoteQr(false)} />}
    </div>
  );
}
