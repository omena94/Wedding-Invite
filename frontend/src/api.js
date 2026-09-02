// 與後端溝通的小工具。所有 API 都在同一個 port 的 /api 底下。
const TOKEN_KEY = "wedding_admin_token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || "";
}
export function setToken(t) {
  localStorage.setItem(TOKEN_KEY, t);
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
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
      msg = data.detail || msg;
    } catch {}
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ===== 賓客端 =====
// Phase 1：意願調查
export const submitPhase1 = (data) => request("/api/rsvp", { method: "POST", body: data });
// Phase 2：用 Email/電話找到自己，再送出詳細資料
export const lookupRsvp = (contact) => request("/api/rsvp/lookup", { method: "POST", body: { contact } });
export const submitPhase2 = (data) => request("/api/rsvp/details", { method: "POST", body: data });

// ===== 後台 =====
export const adminLogin = (password) =>
  request("/api/admin/login", { method: "POST", body: { password } });
export const fetchStats = () => request("/api/admin/stats", { auth: true });
export const fetchRsvps = (params = {}) => {
  const q = new URLSearchParams(params).toString();
  return request(`/api/admin/rsvps${q ? "?" + q : ""}`, { auth: true });
};
export const updateRsvp = (id, data) =>
  request(`/api/admin/rsvps/${id}`, { method: "PATCH", body: data, auth: true });
export const deleteRsvp = (id) =>
  request(`/api/admin/rsvps/${id}`, { method: "DELETE", auth: true });
export const exportCsvUrl = "/api/admin/export.csv";
