import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

const pad = (n) => String(n).padStart(2, "0");
const fmt = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`; // 存檔用 YYYY-MM-DD

// 日曆本體的尺寸估計值：用來判斷往下開放不放得下、以及靠右邊時要往左推多少
const POP_W = 258;
const POP_H = 340;
const GAP = 6;
const MARGIN = 8;

// 按在捲軸上時 offsetX/offsetY 會落在 clientWidth/clientHeight 之外；這種按下不算「點到外面」，
// 否則在可捲動的彈窗裡拉捲軸會把日曆關掉（付款期程「已付」那個視窗就是這樣）。
export const isScrollbarPress = (e) => {
  const t = e.target;
  if (!(t instanceof Element)) return false;
  if (t.clientWidth < t.offsetWidth - 2 && e.offsetX >= t.clientWidth) return true;
  if (t.clientHeight < t.offsetHeight - 2 && e.offsetY >= t.clientHeight) return true;
  return false;
};

/**
 * 自訂日期選擇器（取代原生 input[type=date]）
 * props: value("YYYY-MM-DD" 或 "")、onChange(value)、placeholder
 *
 * 日曆用 portal 浮在整個畫面上（position: fixed），不受可捲動彈窗裁切、也不會撐出彈窗捲軸；
 * 下方放不下就往上開。
 */
export default function DatePicker({ value, onChange, placeholder = "未設定（不限期）" }) {
  const [open, setOpen] = useState(false);
  const today = new Date();
  const init = value ? new Date(value + "T00:00:00") : today;
  const [viewY, setViewY] = useState(init.getFullYear());
  const [viewM, setViewM] = useState(init.getMonth()); // 0-based
  const [pos, setPos] = useState(null);
  const ref = useRef(null);
  const popRef = useRef(null);

  useEffect(() => {
    const onOutside = (e) => {
      if (isScrollbarPress(e)) return;
      if (ref.current?.contains(e.target) || popRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("touchstart", onOutside);
    return () => {
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("touchstart", onOutside);
    };
  }, []);

  // 依觸發按鈕的位置決定日曆放哪：預設在下方，下方不夠而上方較寬就翻到上方；左右不超出畫面
  const place = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(POP_W, vw - MARGIN * 2);
    const left = Math.min(Math.max(MARGIN, r.left), vw - width - MARGIN);
    const below = vh - r.bottom;
    const up = below < POP_H + GAP && r.top > below;
    setPos(up ? { left, width, bottom: vh - r.top + GAP } : { left, width, top: r.bottom + GAP });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    place();
    // 彈窗或頁面捲動、視窗改變大小時跟著移動（scroll 用 capture 才收得到內層容器的捲動）
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

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
  // 日曆開著時 Escape 只關日曆，不要連外層彈窗一起關（Modal 在 window 上聽 Escape）
  const onKey = (e) => {
    if (e.key !== "Escape" || !open) return;
    e.stopPropagation();
    setOpen(false);
  };

  const pop = open && pos && (
    <div className="ui-datepicker-pop" role="dialog" ref={popRef} style={pos} onKeyDown={onKey}>
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
  );

  return (
    <div className={`ui-datepicker${open ? " open" : ""}`} ref={ref} onKeyDown={onKey}>
      <button type="button" className="ui-select-trigger" onClick={toggle} aria-haspopup="dialog" aria-expanded={open}>
        <span className="ui-select-label" style={!value ? { color: "var(--text-muted)" } : undefined}>
          {value ? value.replaceAll("-", ".") : placeholder}
        </span>
        <CalendarDays size={15} className="ui-select-chev" />
      </button>
      {/* 日曆掛在 body 底下，React 事件仍照元件樹往上冒泡，所以彈窗的 stopPropagation 照常生效 */}
      {pop && createPortal(pop, document.body)}
    </div>
  );
}
