import { useEffect, useRef, useState } from "react";

// 常見信箱網域（要增減直接改這裡）
const DOMAINS = ["gmail.com", "yahoo.com.tw", "yahoo.com", "icloud.com", "hotmail.com", "outlook.com"];

/**
 * 帶常見網域建議的 Email 輸入框。
 * props:
 *  - value / onChange(value)
 *  - type: input 類型（預設 email）
 *  - requireAt: true 時要打出 @ 才顯示建議（給「Email 或電話」混用欄位，避免打電話號碼時跳建議）
 */
export default function EmailInput({ value, onChange, type = "email", placeholder, requireAt = false }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("touchstart", onOutside);
    return () => {
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("touchstart", onOutside);
    };
  }, []);

  const v = (value || "").trim();
  const at = v.indexOf("@");
  let suggestions = [];
  if (v && !(requireAt && at === -1)) {
    if (at === -1) {
      suggestions = DOMAINS.map((d) => `${v}@${d}`);
    } else {
      const local = v.slice(0, at);
      const domPart = v.slice(at + 1).toLowerCase();
      if (local) {
        suggestions = DOMAINS
          .filter((d) => d.startsWith(domPart) && d !== domPart)
          .map((d) => `${local}@${d}`);
      }
    }
  }
  const show = open && suggestions.length > 0;

  return (
    <div className="ui-email" ref={ref} onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      {show && (
        <ul className="ui-select-menu" role="listbox">
          {suggestions.map((s) => (
            <li
              key={s}
              role="option"
              className="ui-select-option"
              onMouseDown={(e) => {
                e.preventDefault(); // 避免先觸發 blur
                onChange(s);
                setOpen(false);
              }}
            >
              <span>{s}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
