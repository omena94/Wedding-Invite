import { useEffect, useId, useRef, useState } from "react";

// 常見信箱網域（要增減直接改這裡）
const DOMAINS = ["gmail.com", "yahoo.com.tw", "yahoo.com", "icloud.com", "hotmail.com", "outlook.com"];

/**
 * 帶常見網域建議的 Email 輸入框。
 * props:
 *  - value / onChange(value)
 *  - type: input 類型（預設 email）
 *  - requireAt: true 時要打出 @ 才顯示建議（給「Email 或電話」混用欄位，避免打電話號碼時跳建議）
 */
export default function EmailInput({ value, onChange, type = "email", placeholder, requireAt = false, invalid = false, ...props }) {
  const [open, setOpen] = useState(false);
  const [active,setActive]=useState(-1);
  const listId=useId();
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
        {...props}
        type={type}
        value={value}
        placeholder={placeholder}
        autoComplete={type==='email'?'email':'on'}
        autoCapitalize="none"
        spellCheck={false}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={show}
        aria-controls={show?listId:undefined}
        aria-activedescendant={show&&active>=0?`${listId}-${active}`:undefined}
        aria-invalid={invalid}
        onBlur={()=>setOpen(false)}
        onKeyDown={e=>{
          if(e.key==='Escape'||e.key==='Tab'){setOpen(false);return;}
          if(show&&['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();setActive(i=>Math.max(0,Math.min(suggestions.length-1,i+(e.key==='ArrowDown'?1:-1))));}
          if(show&&e.key==='Enter'&&suggestions[active]){e.preventDefault();onChange(suggestions[active]);setOpen(false);}
        }}
        className={invalid ? "input-error" : undefined}
        onChange={(e) => {
          onChange(e.target.value);
          setActive(-1);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      {show && (
        <ul id={listId} className="ui-select-menu" role="listbox" aria-label="Email 網域建議">
          {suggestions.map((s,i) => (
            <li
              key={s}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={active===i}
              className={`ui-select-option${active===i?' active':''}`}
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
