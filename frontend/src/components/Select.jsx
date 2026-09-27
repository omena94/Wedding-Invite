import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check } from "lucide-react";
import { isScrollbarPress } from "./DatePicker.jsx";

/**
 * 自訂下拉選單（取代原生 <select>，樣式與主題一致）
 * props:
 *  - value, onChange(value)
 *  - options: [{ value, label }]
 *  - compact: 較小尺寸（後台篩選列用）
 *  - portal: 選單掛到 body 用固定定位（2026-09-27 送餅名單用：表格外框會裁掉往下展開的選單；
 *            下面放不下就往上開；頁面捲動或縮放時收合，位置才不會跑掉）
 */
export default function Select({ value, onChange, options, placeholder = "請選擇", compact = false, portal = false, ...props }) {
  const [open, setOpen] = useState(false);
  const [active,setActive]=useState(0);
  const [pos,setPos]=useState(null); // portal 模式的選單位置 {top|bottom, left, width}
  const listId=useId();
  const ref = useRef(null);
  const trigger=useRef(null);
  const menuRef=useRef(null);
  useLayoutEffect(()=>{
    if(!portal||!open||!trigger.current){setPos(null);return;}
    const r=trigger.current.getBoundingClientRect();
    const need=Math.min(264,options.length*44+12)+6;
    const below=window.innerHeight-r.bottom, above=r.top;
    const up=below<need&&above>below;
    // top / bottom 要互斥設定，不然基本樣式的 top 會跟 bottom 一起作用把選單壓扁
    setPos(up?{top:'auto',bottom:window.innerHeight-r.top+6,left:r.left,width:r.width}:{top:r.bottom+6,bottom:'auto',left:r.left,width:r.width});
    const close=(e)=>{ if(e&&e.type==='scroll'&&menuRef.current&&e.target&&e.target.nodeType===1&&menuRef.current.contains(e.target))return; setOpen(false); }; // 選單自己的捲動（把目前選項捲到看得見）不算
    window.addEventListener('scroll',close,true);window.addEventListener('resize',close);
    return()=>{window.removeEventListener('scroll',close,true);window.removeEventListener('resize',close);};
  },[portal,open,options.length]);
  useEffect(()=>{if(open)document.getElementById(`${listId}-${active}`)?.scrollIntoView({block:'nearest'});},[active,open,listId]);

  // 點擊選單外側 → 收合
  useEffect(() => {
    const onOutside = (e) => {
      if (isScrollbarPress(e)) return; // 拉可捲動彈窗的捲軸不算點到外面
      if (ref.current && !ref.current.contains(e.target) && !(menuRef.current && menuRef.current.contains(e.target))) setOpen(false);
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
    trigger.current?.focus();
  };

  return (
    <div
      className={`ui-select${open ? " open" : ""}${compact ? " compact" : ""}`}
      ref={ref}
      onKeyDown={e=>{
        if(e.key==='Tab'||e.key==='Escape'){setOpen(false);return;}
        if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){
          e.preventDefault();setOpen(true);
          setActive(i=>e.key==='Home'?0:e.key==='End'?options.length-1:Math.max(0,Math.min(options.length-1,open?i+(e.key==='ArrowDown'?1:-1):Math.max(0,options.findIndex(o=>String(o.value)===String(value))))));
        }
        if(open&&(e.key==='Enter'||e.key===' ')){e.preventDefault();if(options[active]&&!options[active].disabled)pick(options[active].value);}
      }}
    >
      <button
        type="button"
        {...props}
        ref={trigger}
        role="combobox"
        aria-controls={listId}
        aria-activedescendant={open?`${listId}-${active}`:undefined}
        className="ui-select-trigger"
        onClick={() => {setActive(Math.max(0,options.findIndex(o=>String(o.value)===String(value))));setOpen((o) => !o);}}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="ui-select-label">{current ? current.label : placeholder}</span>
        <ChevronDown size={16} className="ui-select-chev" />
      </button>

      {open && (portal ? createPortal(
        <ul ref={menuRef} id={listId} className={`ui-select-menu${portal ? " portal" : ""}`} style={portal && pos ? pos : undefined} role="listbox" aria-label={props['aria-label']||placeholder}>
          {options.map((o,i) => {
            const selected = String(o.value) === String(value);
            return (
              <li
                key={String(o.value)}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={selected}
                className={`ui-select-option${selected ? " selected" : ""}${active===i?' active':''}${o.disabled ? ' disabled' : ''}`}
                aria-disabled={o.disabled || undefined}
                onClick={() => !o.disabled && pick(o.value)}
              >
                <span>{o.label}</span>
                {selected && <Check size={15} />}
              </li>
            );
          })}
        </ul>
      , document.body) : (
        <ul ref={menuRef} id={listId} className={`ui-select-menu${portal ? " portal" : ""}`} style={portal && pos ? pos : undefined} role="listbox" aria-label={props['aria-label']||placeholder}>
          {options.map((o,i) => {
            const selected = String(o.value) === String(value);
            return (
              <li
                key={String(o.value)}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={selected}
                className={`ui-select-option${selected ? " selected" : ""}${active===i?' active':''}${o.disabled ? ' disabled' : ''}`}
                aria-disabled={o.disabled || undefined}
                onClick={() => !o.disabled && pick(o.value)}
              >
                <span>{o.label}</span>
                {selected && <Check size={15} />}
              </li>
            );
          })}
        </ul>
      ))}
    </div>
  );
}

/** 產生數字選項的小工具：range(1,10,(n)=>`${n} 位`) */
export function range(from, to, labelFn) {
  const out = [];
  for (let n = from; n <= to; n++) out.push({ value: n, label: labelFn ? labelFn(n) : String(n) });
  return out;
}
