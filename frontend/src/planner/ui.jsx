// 籌備後台共用的小元件：頁首、彈窗、欄位、空狀態、確認刪除、載入狀態
import { useEffect, useState, useCallback } from "react";
import Swal from "sweetalert2";
import { X } from "lucide-react";

const SWAL_COLOR = "#B28F70";

export function PageHead({ title, sub, actions }) {
  return (
    <div className="pl-head">
      <div>
        <h1 className="pl-title">{title}</h1>
        {sub && <div className="pl-sub">{sub}</div>}
      </div>
      {actions && <div className="pl-actions">{actions}</div>}
    </div>
  );
}

export function Modal({ title, onClose, children, wide, footer }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className={`modal-card modal-form${wide ? " wide" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="edit-modal-title" style={{ justifyContent: "space-between" }}>
          <span>{title}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="關閉">
            <X size={14} />
          </button>
        </div>
        {children}
        {footer && <div className="edit-modal-actions">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, children, hint, required }) {
  return (
    <div className="form-group">
      {label && <label className={required ? "required" : undefined}>{label}</label>}
      {children}
      {hint && <div className="helper-text">{hint}</div>}
    </div>
  );
}

export function Empty({ children }) {
  return <div className="empty-state">{children}</div>;
}

export function Loading({ children = "讀取中…" }) {
  return <div className="loading">{children}</div>;
}

export function ErrorBox({ error }) {
  if (!error) return null;
  return <div className="loading" style={{ color: "var(--rose-accent)" }}>{error}</div>;
}

export async function confirmDelete(what) {
  const r = await Swal.fire({
    icon: "warning",
    title: `確定要刪除${what ? `「${what}」` : ""}嗎？`,
    text: "此動作無法復原",
    showCancelButton: true,
    confirmButtonText: "刪除",
    cancelButtonText: "取消",
    confirmButtonColor: "#9E5A54",
  });
  return r.isConfirmed;
}

export function toastOk(title) {
  return Swal.fire({ icon: "success", title, timer: 1400, showConfirmButton: false });
}
export function toastErr(e) {
  return Swal.fire({ icon: "error", title: "發生錯誤", text: e?.message || String(e), confirmButtonColor: SWAL_COLOR });
}

/** 簡單的資料載入 hook：{data, loading, error, reload} */
export function useLoader(fn, deps = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    setError("");
    try {
      setData(await fn());
    } catch (e) {
      setError(e.message || "讀取失敗");
    } finally {
      setLoading(false);
    }
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    reload();
  }, [reload]);
  return { data, setData, loading, error, reload };
}

export function Stars({ value = 0, onChange }) {
  return (
    <span className="stars" role={onChange ? "radiogroup" : undefined}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          style={{ cursor: onChange ? "pointer" : "default", opacity: n <= value ? 1 : 0.25, fontSize: 16 }}
          onClick={onChange ? () => onChange(n === value ? 0 : n) : undefined}
        >
          ★
        </span>
      ))}
    </span>
  );
}

/** 數字輸入（純文字欄位＋千分位，不用原生 number 的上下箭頭）。onChange 回傳 "" 或整數 */
export function NumberInput({ value, onChange, placeholder = "0", ...rest }) {
  const display = value === "" || value === null || value === undefined ? "" : Number(value).toLocaleString("en-US");
  return (
    <input
      type="text"
      inputMode="numeric"
      value={display}
      placeholder={placeholder}
      onChange={(e) => {
        const digits = e.target.value.replace(/[^\d]/g, "");
        onChange(digits === "" ? "" : parseInt(digits, 10));
      }}
      {...rest}
    />
  );
}

export const toInt = (v) => (v === "" || v === null || v === undefined ? 0 : parseInt(v, 10) || 0);
