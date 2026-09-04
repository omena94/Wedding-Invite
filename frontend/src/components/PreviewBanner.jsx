// 預覽模式提示：新人或幫手在這個瀏覽器登入過後台，賓客頁面「尚未開放」的功能也會放行，
// 但要清楚標示「賓客現在看不到這個」，免得誤以為已經開放了。
import { Eye, LogOut } from "lucide-react";
import { clearToken } from "../api.js";

export default function PreviewBanner({ stage, closedLabels = [], note }) {
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
