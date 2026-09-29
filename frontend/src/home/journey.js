import { WEDDING_DATE, WEDDING_START } from '../constants.js';

export const VISIT_KEY = 'wedding-invitation-visit-v1';
const START = Date.parse(WEDDING_START);
const END = Date.parse(`${WEDDING_DATE}T23:59:59+08:00`) + 1000;

// 固定以婚宴的台灣時間計算，海外賓客也會看到相同倒數。
export function weddingClock(now = Date.now()) {
  const seconds = Math.max(0, Math.ceil((START - now) / 1000));
  return {
    period: now >= END ? 'after' : now >= START ? 'today' : 'before',
    days: Math.floor(seconds / 86400),
    hours: Math.floor(seconds / 3600) % 24,
    minutes: Math.floor(seconds / 60) % 60,
    seconds: seconds % 60,
  };
}

// 首頁主行動只依正式開關判斷；admin 的預覽入口另外列出。
export function homeAction(stage = {}, period = 'before') {
  // 婚禮後一律導向感謝與出席回覆（婚禮資訊頁已於 2026-09-08 從導覽移除，日期地點都在首頁）；婚紗照不給賓客看（2026-09-08 依新人要求），不再依 photos_open 提供相簿入口
  if (period === 'after') {
    return { id: 'thanks', href: '/rsvp', title: '謝謝你，成為這一天的一部分', description: '那些祝福與笑容，我們都好好收在心裡。', action: '回看我的回覆', label: 'WITH LOVE & THANKS' };
  }
  if (stage.seat_open) return { id: 'seat', href: '/seat', title: '為你留的那一席，準備好了', description: '輸入姓名或手機，從入口一路找到自己的座位。', action: '帶我找到座位', label: '座位查詢已開放' };
  if (stage.phase2_open) return { id: 'details', href: '/details', title: '相聚之前，先為你準備美味', description: '確認同行人數與飲食需求，讓我們照顧每一份期待。', action: '確認我的出席人數', label: '出席確認已開放' };
  return { id: 'rsvp', href: '/rsvp', title: '這場相聚，想把你也寫進來', description: '留一點時間，告訴我們你是否能來，一起完成這一天。', action: '回覆我的出席意願', label: '期待收到你的回覆' };
}

// 只記錄看過喜帖與上次首頁階段，不保存賓客姓名、電話或驗證資料。
export function readVisit(storage, now = Date.now()) {
  try {
    const value = JSON.parse(storage.getItem(VISIT_KEY));
    return value && Number.isFinite(value.openedAt) && value.openedAt > 0 && value.openedAt <= now
      ? { openedAt: value.openedAt, chapter: typeof value.chapter === 'string' ? value.chapter : '' }
      : null;
  } catch { return null; }
}

export function rememberVisit(storage, chapter = '') {
  try { storage.setItem(VISIT_KEY, JSON.stringify({ openedAt: Date.now(), chapter })); } catch { /* 私密模式仍可正常使用。 */ }
}
