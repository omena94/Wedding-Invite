// 共用欄位驗證（Phase 1 / Phase 2 都用這裡，規則要改只改這份）

/** 移除電話中的空格、破折號、括號 */
export function normalizePhone(v) {
  const p = (v || "").replace(/[\s\-()]/g, "");
  return /^\+?8869\d{8}$/.test(p) ? '0' + p.replace(/^\+?886/, '') : p;
}

/** Email 格式：xxx@yyy.zz */
export function isValidEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test((v || "").trim());
}

/** 台灣手機：09 開頭共 10 碼；也接受 +8869 / 8869 開頭 */
export function isValidPhone(v) {
  const p = normalizePhone(v);
  return /^09\d{8}$/.test(p) || /^\+?8869\d{8}$/.test(p);
}

/** 驗證姓名，回傳錯誤訊息（空字串 = 通過） */
export function nameError(v) {
  const s = (v || "").trim();
  if (!s) return "請填寫您的姓名";
  if (s.length > 50) return "姓名太長了，請確認";
  return "";
}

export function emailError(v, required = true) {
  const s = (v || "").trim();
  if (!s) return required ? "請填寫 Email" : "";
  if (!isValidEmail(s)) return "Email 格式不正確（例如 name@gmail.com）";
  return "";
}

export function phoneError(v, required = true) {
  const s = normalizePhone(v);
  if (!s) return required ? "請填寫聯絡電話" : "";
  if (!isValidPhone(s)) return "電話格式不正確，請輸入 09 開頭的 10 碼手機號碼";
  return "";
}
