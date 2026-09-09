// 與後端溝通的小工具。所有 API 都在同一個 port 的 /api 底下。
const TOKEN_KEY = "wedding_admin_token";
const ROLE_KEY = "wedding_admin_role";

export function getToken() {
  // 隱私設定封鎖儲存時，公開賓客頁仍應以未登入身分正常讀取。
  try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; }
}
export function setToken(t) {
  localStorage.setItem(TOKEN_KEY, t);
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(ROLE_KEY);
}
export function getRole() {
  return localStorage.getItem(ROLE_KEY) || "couple";
}
export function setRole(r) {
  localStorage.setItem(ROLE_KEY, r || "couple");
}

// authOptional：賓客頁用。有登入過後台就順便帶 token，後端會回 preview=true 並放行尚未開放的功能；
// 沒登入就是一般賓客，不會因此被擋。
async function request(path, { method = "GET", body, auth = false, authOptional = false } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth || (authOptional && getToken())) headers["Authorization"] = `Bearer ${getToken()}`;

  let res;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 70000);
  try { res = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: controller.signal,
  }); } catch { throw new Error('連線暫時中斷，請確認網路後再試一次'); }
  finally { clearTimeout(timeout); }

  if (res.status === 401 && auth) {
    clearToken();
    throw new Error("登入已失效，請重新登入");
  }
  if (!res.ok) {
    let msg = "發生錯誤";
    try {
      const data = await res.json();
      if (typeof data.detail === "string") msg = data.detail;
      else if (Array.isArray(data.detail) && data.detail[0]?.msg) msg = data.detail[0].msg;
    } catch {}
    const err = new Error(msg);
    err.status = res.status; // 讓前端可依狀態碼做不同處理（如 409 重複填寫、403 尚未開放）
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

const qs = (params = {}) => {
  const clean = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== "" && v !== null && v !== undefined)
  );
  const s = new URLSearchParams(clean).toString();
  return s ? "?" + s : "";
};

// ===== 賓客端 =====
// Phase 1：意願調查
export const submitPhase1 = (data) => request("/api/rsvp", { method: "POST", body: data });
// Phase 2：用 Email/電話找到自己，再送出詳細資料
export const lookupRsvp = (contact, access_token = '') => request("/api/rsvp/lookup", { method: "POST", body: { contact, access_token }, authOptional: true });
export const requestVerification = contact => request('/api/rsvp/verification', {method:'POST',body:{contact},authOptional:true});
export const verifyGuest = (challenge_id,code) => request('/api/rsvp/verify', {method:'POST',body:{challenge_id,code}});
export const submitPhase2 = (data) => request("/api/rsvp/details", { method: "POST", body: data, authOptional: true });
// 目前階段（第二階段開了沒、桌次查詢開了沒…）；登入後台的人會多拿到 preview=true
export const fetchStage = () => request("/api/stage", { authOptional: true });
export const fetchInfo = () => request("/api/info", { authOptional: true });
export const seatLookup = (query, phone = '') => request("/api/seat/lookup", { method: "POST", body: { query, phone }, authOptional: true });
export const fetchPhotos = () => request("/api/photos", { authOptional: true });
export const photoUrl = (id) => `/api/photos/${id}`;
export const photoThumbUrl = (id) => `/api/photos/${id}/thumb`;
// 預覽模式下照片頁還沒開放，<img src> 帶不了 token，改用 fetch 取回 blob
export async function fetchAuthBlobUrl(url) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) throw new Error("讀取失敗");
  return URL.createObjectURL(await res.blob());
}

// ===== 登入（新人 / 幫手共用）=====
export const adminLogin = (password) =>
  request("/api/admin/login", { method: "POST", body: { password } });

// ===== 賓客後台 =====
export const fetchStats = () => request("/api/admin/stats", { auth: true });
export const fetchRsvps = (params = {}) => request(`/api/admin/rsvps${qs(params)}`, { auth: true });
export const createRsvp = (data) => request("/api/admin/rsvps", { method: "POST", body: data, auth: true });
export const updateRsvp = (id, data) =>
  request(`/api/admin/rsvps/${id}`, { method: "PATCH", body: data, auth: true });
export const deleteRsvp = (id) =>
  request(`/api/admin/rsvps/${id}`, { method: "DELETE", auth: true });
// 群發（multipart，支援附件）：fields = {subject, body, target, test_to}，files = File[]
export async function sendBroadcast(fields, files = []) {
  const fd = new FormData();
  Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
  files.forEach((f) => fd.append("files", f));
  return multipart("/api/admin/broadcast", fd);
}
export const exportCsvUrl = "/api/admin/export.csv";

async function multipart(path, fd, method = "POST") {
  const res = await fetch(path, {
    method,
    headers: { Authorization: `Bearer ${getToken()}` },
    body: fd, // 不設 Content-Type，讓瀏覽器自帶 multipart boundary
  });
  if (res.status === 401) {
    clearToken();
    throw new Error("登入已失效，請重新登入");
  }
  if (!res.ok) {
    let msg = "發生錯誤";
    try {
      const data = await res.json();
      if (typeof data.detail === "string") msg = data.detail;
    } catch {}
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// ===== 籌備後台（僅新人）=====
const P = "/api/planner";
const GIFTS = `${P}/gifts`;
export const fetchGifts = () => request(GIFTS, { auth: true });
export const saveGiftProduct = (id, data) => request(`${GIFTS}/products${id ? `/${id}` : ""}`, { method: id ? "PUT" : "POST", body: data, auth: true });
export const saveGiftRecipient = (id, data) => request(`${GIFTS}/recipients${id ? `/${id}` : ""}`, { method: id ? "PUT" : "POST", body: data, auth: true });
export const saveGiftOrder = (id, data) => request(`${GIFTS}/orders${id ? `/${id}` : ""}`, { method: id ? "PUT" : "POST", body: data, auth: true });
export const createGiftDelivery = (id, data) => request(`${GIFTS}/recipients/${id}/deliveries`, { method: "POST", body: data, auth: true });
export const updateGiftDelivery = (id, data) => request(`${GIFTS}/deliveries/${id}`, { method: "PATCH", body: data, auth: true });
export const importGiftGuests = () => request(`${GIFTS}/recipients/import-guests`, { method: "POST", auth: true });
export const deleteGiftRecipient = (id) => request(`${GIFTS}/recipients/${id}`, { method: "DELETE", auth: true });
export async function downloadGiftCsv(method = "all") {
  const response = await fetch(`${GIFTS}/export.csv?method=${encodeURIComponent(method)}`, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!response.ok) throw new Error("喜餅清單匯出失敗，請確認登入後重試");
  const url = URL.createObjectURL(await response.blob());
  const a = document.createElement("a"); a.href = url; a.download = `喜餅清單-${method}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export const fetchPlannerSettings = () => request(`${P}/settings`, { auth: true });
export const savePlannerSettings = (values) =>
  request(`${P}/settings`, { method: "PATCH", body: values, auth: true });
export const fetchDashboard = () => request(`${P}/dashboard`, { auth: true });
export const fetchBanquet = () => request(`${P}/banquet`, { auth: true });
export const saveBanquet = (params) => request(`${P}/banquet`, { method: "PATCH", body: params, auth: true });

export const fetchCategories = () => request(`${P}/categories`, { auth: true });
export const createCategory = (name) => request(`${P}/categories`, { method: "POST", body: { name }, auth: true });
export const updateCategory = (id, data) =>
  request(`${P}/categories/${id}`, { method: "PATCH", body: data, auth: true });
export const deleteCategory = (id) => request(`${P}/categories/${id}`, { method: "DELETE", auth: true });
export const reorderCategories = (ids) =>
  request(`${P}/categories/reorder`, { method: "POST", body: { ids }, auth: true });

export const fetchVendors = (params = {}) => request(`${P}/vendors${qs(params)}`, { auth: true });
export const fetchVendorCategories = () => request(`${P}/vendors/categories`, { auth: true });
export const fetchVendor = (id) => request(`${P}/vendors/${id}`, { auth: true });
export const createVendor = (data) => request(`${P}/vendors`, { method: "POST", body: data, auth: true });
export const updateVendor = (id, data) =>
  request(`${P}/vendors/${id}`, { method: "PATCH", body: data, auth: true });
export const deleteVendor = (id) => request(`${P}/vendors/${id}`, { method: "DELETE", auth: true });

export const createQuote = (vendorId, data) =>
  request(`${P}/vendors/${vendorId}/quotes`, { method: "POST", body: data, auth: true });
export const updateQuote = (id, data) =>
  request(`${P}/quotes/${id}`, { method: "PATCH", body: data, auth: true });
export const deleteQuote = (id) => request(`${P}/quotes/${id}`, { method: "DELETE", auth: true });
export const fetchCompare = (category) =>
  request(`${P}/compare?category=${encodeURIComponent(category)}`, { auth: true });

export const fetchExpenses = () => request(`${P}/expenses`, { auth: true });
export const createExpense = (data) => request(`${P}/expenses`, { method: "POST", body: data, auth: true });
export const updateExpense = (id, data) =>
  request(`${P}/expenses/${id}`, { method: "PATCH", body: data, auth: true });
export const deleteExpense = (id) => request(`${P}/expenses/${id}`, { method: "DELETE", auth: true });

export const fetchPayments = (status = "all") => request(`${P}/payments?status=${status}`, { auth: true });
export const createPayment = (expenseId, data) =>
  request(`${P}/expenses/${expenseId}/payments`, { method: "POST", body: data, auth: true });
export const updatePayment = (id, data) =>
  request(`${P}/payments/${id}`, { method: "PATCH", body: data, auth: true });
export const deletePayment = (id) => request(`${P}/payments/${id}`, { method: "DELETE", auth: true });

export const fetchTasks = (status = "all") => request(`${P}/tasks?status=${status}`, { auth: true });
export const createTask = (data) => request(`${P}/tasks`, { method: "POST", body: data, auth: true });
export const updateTask = (id, data) =>
  request(`${P}/tasks/${id}`, { method: "PATCH", body: data, auth: true });
export const deleteTask = (id) => request(`${P}/tasks/${id}`, { method: "DELETE", auth: true });

// 備忘：可獨立、可掛在待辦或花費底下（params: status / topic / task_id / expense_id）
export const fetchMemos = (params = {}) => {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""));
  return request(`${P}/memos${q.toString() ? `?${q}` : ""}`, { auth: true });
};
export const createMemo = (data) => request(`${P}/memos`, { method: "POST", body: data, auth: true });
export const updateMemo = (id, data) => request(`${P}/memos/${id}`, { method: "PATCH", body: data, auth: true });
export const deleteMemo = (id) => request(`${P}/memos/${id}`, { method: "DELETE", auth: true });

// 活動環節（婚禮當天流程）與點子
export const fetchSegments = () => request(`${P}/program/segments`, { auth: true });
export const createSegment = (data) => request(`${P}/program/segments`, { method: "POST", body: data, auth: true });
export const updateSegment = (id, data) => request(`${P}/program/segments/${id}`, { method: "PATCH", body: data, auth: true });
export const reorderSegments = (ids) => request(`${P}/program/segments/reorder`, { method: "POST", body: { ids }, auth: true });
export const deleteSegment = (id) => request(`${P}/program/segments/${id}`, { method: "DELETE", auth: true });
export const fetchIdeas = (params = {}) => {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""));
  return request(`${P}/program/ideas${q.toString() ? `?${q}` : ""}`, { auth: true });
};
export const createIdea = (data) => request(`${P}/program/ideas`, { method: "POST", body: data, auth: true });
export const updateIdea = (id, data) => request(`${P}/program/ideas/${id}`, { method: "PATCH", body: data, auth: true });
export const deleteIdea = (id) => request(`${P}/program/ideas/${id}`, { method: "DELETE", auth: true });
export const fetchGames = () => request(`${P}/program/games`, { auth: true });
export const fetchGame = (id) => request(`${P}/program/games/${id}`, { auth: true });
export const createGame = (data) => request(`${P}/program/games`, { method: "POST", body: data, auth: true });
export const updateGame = (id, data) => request(`${P}/program/games/${id}`, { method: "PATCH", body: data, auth: true });
export const deleteGame = (id) => request(`${P}/program/games/${id}`, { method: "DELETE", auth: true });

// ===== 座位圖 =====
const SE = `${P}/seating`;
export const fetchSeating = (readonly = false) => request(readonly ? "/api/admin/seating" : SE, { auth: true });
export const fetchSeatPreview = (rsvpId) => request(`/api/admin/seating/preview/${rsvpId}`, { auth: true });
export const setSeatingCanvas = (w, h, clearance = 20) => request(`${SE}/canvas`, { method: "PATCH", body: { w, h, clearance }, auth: true });
export const createSeatObject = (data) => request(`${SE}/objects`, { method: "POST", body: data, auth: true });
export const updateSeatObject = (id, data) => request(`${SE}/objects/${id}`, { method: "PATCH", body: data, auth: true });
export const moveSeatObjects = (items) => request(`${SE}/objects/move`, { method: "POST", body: items, auth: true });
export const deleteSeatObject = (id) => request(`${SE}/objects/${id}`, { method: "DELETE", auth: true });
export const clearSeatObject = (id) => request(`${SE}/objects/${id}/assignments`, { method: "DELETE", auth: true });
export const assignSeat = (data) => request(`${SE}/assign`, { method: "PUT", body: data, auth: true });
export const assignGroup = (object_id, rsvp_id) =>
  request(`${SE}/assign-group`, { method: "POST", body: { object_id, rsvp_id }, auth: true });
export const renameAssignment = (id, display_name) =>
  request(`${SE}/assign/${id}`, { method: "PATCH", body: { display_name }, auth: true });
export const unassignSeat = (id) => request(`${SE}/assign/${id}`, { method: "DELETE", auth: true });
export const clearAllSeats = () => request(`${SE}/assignments`, { method: "DELETE", auth: true });
export const autoAssignSeats = (opts) => request(`${SE}/auto-assign`, { method: "POST", body: opts, auth: true });

// ===== 照片相簿 =====
export const fetchPlannerPhotos = () => request(`${P}/photos`, { auth: true });
export const reorderPhotos = (ids) => request(`${P}/photos/reorder`, { method: "POST", body: { ids }, auth: true });
export const publishPhotos = (ids, is_public) =>
  request(`${P}/photos/publish`, { method: "POST", body: { ids, is_public }, auth: true });
export async function fetchThumbBlobUrl(id) {
  const res = await fetch(`${P}/files/${id}/thumb`, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) throw new Error("讀取縮圖失敗");
  return URL.createObjectURL(await res.blob());
}

export const fetchFiles = (params = {}) => request(`${P}/files${qs(params)}`, { auth: true });
export function uploadFile(file, fields = {}) {
  const fd = new FormData();
  fd.append("file", file);
  Object.entries(fields).forEach(([k, v]) => {
    if (v !== "" && v !== null && v !== undefined) fd.append(k, v);
  });
  return multipart(`${P}/files`, fd);
}
export const updateFile = (id, data) =>
  request(`${P}/files/${id}`, { method: "PATCH", body: data, auth: true });
export const deleteFile = (id) => request(`${P}/files/${id}`, { method: "DELETE", auth: true });

// 檔案需要登入才能下載，所以用 fetch 帶 token 取回 blob，再交給瀏覽器
export async function fetchFileBlob(id) {
  const res = await fetch(`${P}/files/${id}/download`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (res.status === 401) {
    clearToken();
    throw new Error("登入已失效，請重新登入");
  }
  if (!res.ok) throw new Error("下載失敗");
  return res.blob();
}
export async function downloadFile(id, filename) {
  const blob = await fetchFileBlob(id);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "file";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export async function openFile(id) {
  const blob = await fetchFileBlob(id);
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
