import { useEffect, useRef, useState } from "react";
import { ChevronDown, Check } from "lucide-react";

/**
 * 自訂下拉選單（取代原生 <select>，樣式與主題一致）
 * props:
 *  - value, onChange(value)
 *  - options: [{ value, label }]
 *  - compact: 較小尺寸（後台篩選列用）
 */
export default function Select({ value, onChange, options, placeholder = "請選擇", compact = false }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // 點擊選單外側 → 收合
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

  const current = options.find((o) => String(o.value) === String(value));

  const pick = (v) => {
    onChange(v);
    setOpen(false);
  };

  return (
    <div
      className={`ui-select${open ? " open" : ""}${compact ? " compact" : ""}`}
      ref={ref}
      onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
    >
      <button
        type="button"
        className="ui-select-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="ui-select-label">{current ? current.label : placeholder}</span>
        <ChevronDown size={16} className="ui-select-chev" />
      </button>

      {open && (
        <ul className="ui-select-menu" role="listbox">
          {options.map((o) => {
            const selected = String(o.value) === String(value);
            return (
              <li
                key={String(o.value)}
                role="option"
                aria-selected={selected}
                className={`ui-select-option${selected ? " selected" : ""}`}
                onClick={() => pick(o.value)}
              >
                <span>{o.label}</span>
                {selected && <Check size={15} />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** 產生數字選項的小工具：range(1,10,(n)=>`${n} 位`) */
export function range(from, to, labelFn) {
  const out = [];
  for (let n = from; n <= to; n++) out.push({ value: n, label: labelFn ? labelFn(n) : String(n) });
  return out;
}
