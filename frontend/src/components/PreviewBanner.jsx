// 預覽模式提示：新人或幫手在這個瀏覽器登入過後台，賓客頁面「尚未開放」的功能也會放行，
// 但要清楚標示「賓客現在看不到這個」，免得誤以為已經開放了。
import { createPortal } from "react-dom";
import { Eye, LogOut, Undo2 } from "lucide-react";
import { clearToken, getStashedCouple, getToken, restoreCouple } from "../api.js";

export default function PreviewBanner({ stage, closedLabels = [], note }) {
  // 2026-09-29 新人按了「賓客」視角：後台暫時登出，這裡看到的就是賓客看到的；一鍵切回去
  if (!getToken() && getStashedCouple()) {
    // 用 portal 掛到 body：頁面容器自己有 stacking context，不然會被首頁的邀請卡封面蓋住
    return createPortal(
      <div className="preview-banner guest-view" role="status">
        <span><Eye size={14} style={{ verticalAlign: "-2px", marginRight: 4 }} /><strong>賓客視角</strong>：現在看到的跟賓客一模一樣。</span>
        <span className="preview-actions">
          <button type="button" onClick={() => { if (restoreCouple()) window.location.href = "/planner"; }}><Undo2 size={12} /> 切回新人後台</button>
        </span>
      </div>,
      document.body,
    );
  }
  if (!stage || !stage.preview || closedLabels.length === 0) return null;
  const logout = () => {
    clearToken();
    window.location.reload();
  };
  return (
    <div className="preview-banner" role="status">
      <span>
        <Eye size={14} style={{ verticalAlign: "-2px", marginRight: 4 }} />
        <strong>預覽模式</strong>：你已登入後台，所以看得到。{closedLabels.join("、")}目前<strong>尚未開放</strong>，賓客看到的仍是「尚未開放」。
      </span>
      <span className="preview-actions">
        <a href="/planner/settings">去後台開放</a>
        <button type="button" onClick={logout}><LogOut size={12} /> 登出，用賓客視角看</button>
      </span>
      {note && <span className="preview-note">{note}</span>}
    </div>
  );
}
