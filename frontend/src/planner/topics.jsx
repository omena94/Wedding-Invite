// 行事曆與筆記共用的主題（婚紗攝影、禮服、喜餅…）：從後台讀取，內建六個加上新人自訂過的。
// 每個主題配一個固定顏色，月曆上的事件與筆記的標籤都用同一套，看顏色就知道是哪條線。
import { useCallback, useEffect, useState } from "react";
import { fetchTopics } from "../api.js";

export const DEFAULT_TOPICS = ["婚紗攝影", "禮服", "喜餅", "婚宴", "喜帖與小物", "其他"];

// 奶茶色系底下挑的六個柔和色；超過六個主題就從頭循環
const PALETTE = [
  { bg: "#f3e4ea", fg: "#8c4a5e" }, // 玫瑰
  { bg: "#e6ebf4", fg: "#4b5f8a" }, // 藍灰
  { bg: "#f6ebd6", fg: "#8a6117" }, // 蜂蜜
  { bg: "#e4efe6", fg: "#3f6b4a" }, // 抹茶
  { bg: "#ece4f2", fg: "#6a4f85" }, // 薰衣草
  { bg: "#ece7e1", fg: "#6b5a4a" }, // 奶茶（其他）
];

export function topicColor(topic, topics = DEFAULT_TOPICS) {
  if (!topic) return PALETTE[PALETTE.length - 1];
  const i = topics.indexOf(topic);
  return PALETTE[(i >= 0 ? i : topics.length + Math.abs(hash(topic))) % PALETTE.length];
}

function hash(s) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return h;
}

export function useTopics() {
  const [list, setList] = useState(null);
  const reload = useCallback(() => fetchTopics().then(setList).catch(() => setList(DEFAULT_TOPICS)), []);
  useEffect(() => {
    reload();
  }, [reload]);
  return { topics: list || DEFAULT_TOPICS, loaded: list !== null, reload };
}

/** 主題小標籤 */
export function TopicTag({ topic, topics, small }) {
  if (!topic) return null;
  const c = topicColor(topic, topics);
  return <span className={`topic-tag${small ? " small" : ""}`} style={{ background: c.bg, color: c.fg }}>{topic}</span>;
}
