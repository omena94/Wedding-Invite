// 自訂開關與核取方塊（取代原生 input[type=checkbox]）
import { Check } from "lucide-react";

/** 開關：<Toggle checked onChange(bool) disabled /> */
export default function Toggle({ checked, onChange, disabled = false, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!!checked}
      aria-label={label}
      className={`ui-toggle${checked ? " on" : ""}`}
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); if (!disabled) onChange(!checked); }}
    />
  );
}

/** 核取方塊：<Checkbox checked onChange(bool)>文字</Checkbox> */
export function Checkbox({ checked, onChange, disabled = false, children, className = "" }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={!!checked}
      className={`ui-check${checked ? " on" : ""}${className ? ` ${className}` : ""}`}
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); if (!disabled) onChange(!checked); }}
    >
      <span className="ui-check-box">{checked && <Check size={12} strokeWidth={3} />}</span>
      {children !== undefined && children !== null && <span className="ui-check-label">{children}</span>}
    </button>
  );
}
