// 全站共用的常數與小工具（文案、選項、格式化）

// 婚禮日期（倒數用）。改日期只要改這一行。
export const WEDDING_DATE = "2027-03-13";
export const WEDDING_START = `${WEDDING_DATE}T12:00:00+08:00`;
export const WEDDING_DATE_DISPLAY = WEDDING_DATE.replaceAll('-', ' · ');
export const OUR_STORY = [
  { date: '2019-04-29', label: '故事的開始', title: '從你和我，到我們', text: '從這一天起，故事裡多了一個「我們」。一起分享日常，也一起期待下一次出發。', mark: '01' },
  { date: '2027-01-26', label: '預計登記結婚', title: '把往後的日子，寫在一起', text: '我們計畫在這一天登記結婚。帶著這些年累積的喜歡，走進下一段人生。', mark: '02' },
  { date: WEDDING_DATE, label: '婚宴之約', title: '下一頁，想和你一起', text: '最重要的一天，想和最珍惜的人一起度過。這次，邀請你也走進我們的故事。', mark: '03' },
];

export const VENDOR_CATEGORIES = [
  "婚宴場地", "婚紗攝影", "禮服", "新秘造型", "婚戒", "喜餅", "喜帖",
  "婚攝婚錄", "主持", "樂團表演", "婚車", "佈置花藝", "蜜月", "其他",
];

export const VENDOR_STATUS = {
  candidate: "候選",
  quoted: "已報價",
  signed: "已簽約",
  done: "已完成",
  rejected: "放棄",
};
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
export const TASK_KIND = { task: "待辦", milestone: "里程碑" };

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
