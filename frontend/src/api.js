// 與後端溝通的小工具。所有 API 都在同一個 port 的 /api 底下。
const TOKEN_KEY = "wedding_admin_token";
const ROLE_KEY = "wedding_admin_role";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || "";
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

async function request(path, { method = "GET", body, auth = false } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth) headers["Authorization"] = `Bearer ${getToken()}`;

  const res = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
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
export const lookupRsvp = (contact) => request("/api/rsvp/lookup", { method: "POST", body: { contact } });
export const submitPhase2 = (data) => request("/api/rsvp/details", { method: "POST", body: data });
// 目前階段（第二階段開了沒、桌次查詢開了沒…）
export const fetchStage = () => request("/api/stage");
export const fetchInfo = () => request("/api/info");
export const seatLookup = (query) => request("/api/seat/lookup", { method: "POST", body: { query } });
export const fetchPhotos = () => request("/api/photos");
export const photoUrl = (id) => `/api/photos/${id}`;
export const photoThumbUrl = (id) => `/api/photos/${id}/thumb`;

// ===== 登入（新人 / 幫手共用）=====
export const adminLogin = (password) =>
  request("/api/admin/login", { method: "POST", body: { password } });

// ===== 賓客後台 =====
export const fetchStats = () => request("/api/admin/stats", { auth: true });
export const fetchRsvps = (params = {}) => request(`/api/admin/rsvps${qs(params)}`, { auth: true });
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

// ===== 座位圖 =====
const SE = `${P}/seating`;
export const fetchSeating = (readonly = false) => request(readonly ? "/api/admin/seating" : SE, { auth: true });
export const setSeatingCanvas = (w, h) => request(`${SE}/canvas`, { method: "PATCH", body: { w, h }, auth: true });
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
