// 活動環節頁與環節編輯頁共用的選項（2026-10-01 環節編輯從彈窗改成獨立頁面時抽出來）
import { WEDDING_TIME_FROM, WEDDING_TIME_TO } from "../constants.js";

export const SEG_STATUS = { draft: "規劃中", confirmed: "已確定" };
export const toOptions = (map) => Object.entries(map).map(([value, label]) => ({ value, label }));

// 時間選項：婚禮時段 12:00～15:00 每 5 分鐘（不用原生 time 輸入）
export const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
export const TIME_OPTIONS = [{ value: "", label: "未定" }];
for (let t = toMin(WEDDING_TIME_FROM); t <= toMin(WEDDING_TIME_TO); t += 5) {
  const v = `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
  TIME_OPTIONS.push({ value: v, label: v });
}
