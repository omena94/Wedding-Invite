// 自訂日期＋時間選擇器（取代原生 input[type=datetime-local]）
// value: "YYYY-MM-DDTHH:mm"（本地時間，無時區）或 ""；onChange(value)
import DatePicker from "./DatePicker.jsx";
import Select from "./Select.jsx";
import { todayISO } from "../constants.js";

const pad = (n) => String(n).padStart(2, "0");
const HOURS = Array.from({ length: 24 }, (_, h) => ({ value: pad(h), label: `${pad(h)} 時` }));
const MINUTES = Array.from({ length: 12 }, (_, i) => ({ value: pad(i * 5), label: `${pad(i * 5)} 分` }));

export default function DateTimePicker({ value, onChange, placeholder = "選擇日期" }) {
  const [date = "", time = ""] = value ? value.split("T") : [];
  const [hh = "09", mm = "00"] = time ? time.split(":") : [];
  const minutes = MINUTES.some((m) => m.value === mm) ? MINUTES : [...MINUTES, { value: mm, label: `${mm} 分` }].sort((a, b) => a.value.localeCompare(b.value));

  const emit = (d, h, m) => onChange(d ? `${d}T${h}:${m}` : "");

  return (
    <div className="ui-datetime">
      <DatePicker value={date} onChange={(d) => emit(d, hh, mm)} placeholder={placeholder} />
      <Select compact value={hh} onChange={(h) => emit(date || todayISO(), h, mm)} options={HOURS} />
      <Select compact value={mm} onChange={(m) => emit(date || todayISO(), hh, m)} options={minutes} />
    </div>
  );
}
