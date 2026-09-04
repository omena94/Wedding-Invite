import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

const pad = (n) => String(n).padStart(2, "0");
const fmt = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`; // 存檔用 YYYY-MM-DD

/**
 * 自訂日期選擇器（取代原生 input[type=date]）
 * props: value("YYYY-MM-DD" 或 "")、onChange(value)、placeholder
 */
export default function DatePicker({ value, onChange, placeholder = "未設定（不限期）" }) {
  const [open, setOpen] = useState(false);
  const today = new Date();
  const init = value ? new Date(value + "T00:00:00") : today;
  const [viewY, setViewY] = useState(init.getFullYear());
  const [viewM, setViewM] = useState(init.getMonth()); // 0-based
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

  const toggle = () => {
    // 打開時跳到已選日期的月份
    if (!open && value) {
      const d = new Date(value + "T00:00:00");
      if (!isNaN(d)) {
        setViewY(d.getFullYear());
        setViewM(d.getMonth());
      }
    }
    setOpen((o) => !o);
  };

  const prevMonth = () => (viewM === 0 ? (setViewM(11), setViewY(viewY - 1)) : setViewM(viewM - 1));
  const nextMonth = () => (viewM === 11 ? (setViewM(0), setViewY(viewY + 1)) : setViewM(viewM + 1));

  const firstDow = new Date(viewY, viewM, 1).getDay();
  const daysInMonth = new Date(viewY, viewM + 1, 0).getDate();
  const cells = [...Array(firstDow).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  const todayStr = fmt(today.getFullYear(), today.getMonth() + 1, today.getDate());

  const pick = (v) => {
    onChange(v);
    setOpen(false);
  };

  return (
    <div className={`ui-datepicker${open ? " open" : ""}`} ref={ref} onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
      <button type="button" className="ui-select-trigger" onClick={toggle} aria-haspopup="dialog" aria-expanded={open}>
        <span className="ui-select-label" style={!value ? { color: "var(--text-muted)" } : undefined}>
          {value ? value.replaceAll("-", ".") : placeholder}
        </span>
        <CalendarDays size={15} className="ui-select-chev" />
      </button>

      {open && (
        <div className="ui-datepicker-pop" role="dialog">
          <div className="ui-datepicker-head">
            <button type="button" className="ui-datepicker-nav" onClick={prevMonth} aria-label="上個月"><ChevronLeft size={16} /></button>
            <span className="ui-datepicker-title">{viewY} 年 {viewM + 1} 月</span>
            <button type="button" className="ui-datepicker-nav" onClick={nextMonth} aria-label="下個月"><ChevronRight size={16} /></button>
          </div>

          <div className="ui-datepicker-grid">
            {WEEKDAYS.map((w) => <div key={w} className="ui-datepicker-wd">{w}</div>)}
            {cells.map((d, i) => {
              if (d === null) return <div key={`e${i}`} />;
              const ds = fmt(viewY, viewM + 1, d);
              const cls = ["ui-datepicker-day"];
              if (ds === value) cls.push("selected");
              else if (ds === todayStr) cls.push("today");
              return (
                <button type="button" key={ds} className={cls.join(" ")} onClick={() => pick(ds)}>
                  {d}
                </button>
              );
            })}
          </div>

          <div className="ui-datepicker-foot">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => pick("")}><X size={13} /> 清除</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => pick(todayStr)}>今天</button>
          </div>
        </div>
      )}
    </div>
  );
}
