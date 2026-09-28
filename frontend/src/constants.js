// 全站共用的常數與小工具（文案、選項、格式化）

// 婚禮日期（倒數用）。改日期只要改這一行。
export const WEDDING_DATE = "2027-03-13";
export const WEDDING_START = `${WEDDING_DATE}T12:00:00+08:00`;
// 2026-09-09 新人確認婚禮 12:00～15:00，共 3 小時（活動環節頁的時間下拉與合計對照用）
export const WEDDING_TIME_FROM = "12:00";
export const WEDDING_TIME_TO = "15:00";
export const WEDDING_MINUTES = 180;
export const WEDDING_DATE_DISPLAY = WEDDING_DATE.replaceAll('-', ' · ');
export const EXPENSE_CATEGORIES = [
  "婚宴場地", "婚紗攝影", "婚禮禮服租借", "新秘造型", "婚戒", "喜餅", "喜帖",
  "婚禮攝影", "主持", "樂團表演", "婚車", "佈置花藝", "蜜月", "其他",
];

export const STATUS_PILL = {
  candidate: "pill-groom",
  quoted: "pill-bride",
  signed: "pill-yes",
  done: "pill-yes",
  rejected: "pill-no",
};

export const PAID_BY = { groom: "新郎", bride: "新娘", shared: "共同", family: "家長" };
export const ASSIGNEE = { groom: "新郎", bride: "新娘", both: "兩人" };
export const PAY_METHODS = ["ATM", "現金", "信用卡", "LINE Pay", "其他"];
export const FILE_KIND = { doc: "文件", receipt: "收據", photo: "照片" };

export const toOptions = (obj) => Object.entries(obj).map(([value, label]) => ({ value, label }));
export const listOptions = (arr) => arr.map((v) => ({ value: v, label: v }));

export const money = (n) => "NT$ " + Number(n || 0).toLocaleString("zh-TW");
export const fmtDate = (iso) => (iso ? String(iso).slice(0, 10).replace(/-/g, "/") : "—");
export const fmtSize = (bytes) => {
  if (!bytes) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

export const todayISO = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

// 距離某天還有幾天（以手機/電腦本地日期計算；台灣賓客即台灣時間）
export function daysUntil(iso) {
  if (!iso) return null;
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(y, m - 1, d);
  return Math.round((target - today) / 86400000);
}

// 把 ISO 時間字串顯示成「2026/10/01 09:00」（用瀏覽器本地時區，台灣即台灣時間）
export function fmtDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// datetime-local 輸入值（本地時間，無時區）→ 帶 +08:00 的 ISO 字串
export function localToISO(local) {
  if (!local) return "";
  return local.length === 16 ? `${local}:00+08:00` : `${local}+08:00`;
}
// ISO（任意時區）→ datetime-local 需要的 "YYYY-MM-DDTHH:mm"（以瀏覽器本地時間呈現）
export function isoToLocal(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 新人的名字（2026-09-28 大螢幕用；賓客頁的標題另外寫在 GuestUI.jsx）
export const COUPLE_EN = "Alan & Omena";
export const COUPLE_ZH = "宣文 & 孟庭";
