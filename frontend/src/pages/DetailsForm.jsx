import { useEffect, useState } from "react";
import { Search, Users, Utensils, Baby, Salad, PenLine, Send, PartyPopper, CalendarX } from "lucide-react";
import Select, { range } from "../components/Select.jsx";
import EmailInput from "../components/EmailInput.jsx";
import { fetchConfig, lookupRsvp, submitPhase2 } from "../api.js";
import { isValidEmail, isValidPhone, normalizePhone } from "../validators.js";

// 主餐選項（要改直接改這裡）
const MAIN_DISHES = ["牛排", "雞腿排", "鮭魚排", "素食"];

export default function DetailsForm() {
  const [step, setStep] = useState("lookup"); // lookup | form | done
  const [contact, setContact] = useState("");
  const [guest, setGuest] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [closed, setClosed] = useState(false); // 是否已過截止日

  useEffect(() => {
    fetchConfig()
      .then((c) => setClosed(!c.phase2_open))
      .catch(() => {});
  }, []);

  const [form, setForm] = useState({
    adult_count: 1,
    child_count: 0,
    main_course: Object.fromEntries(MAIN_DISHES.map((d) => [d, 0])),
    kids_meal_count: 0,
    baby_chair_count: 0,
    veg_type: "無",
    dietary_note: "",
    remark: "",
  });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setMain = (dish, v) =>
    setForm((f) => ({ ...f, main_course: { ...f.main_course, [dish]: v } }));

  const mainTotal = Object.values(form.main_course).reduce((a, b) => a + (b || 0), 0);

  const doLookup = async (e) => {
    e.preventDefault();
    setError("");
    const c = contact.trim();
    if (!c) return setError("請輸入您第一階段填寫的 Email 或電話");
    if (!isValidEmail(c) && !isValidPhone(c))
      return setError("格式不正確，請輸入有效的 Email 或 09 開頭的 10 碼手機號碼");
    setBusy(true);
    try {
      const r = await lookupRsvp(isValidPhone(c) ? normalizePhone(c) : c);
      if (!r.found) {
        setError("找不到您的意願調查紀錄。請確認 Email／電話與第一階段相同，或先完成第一階段。");
      } else if (!r.attending) {
        setError("您先前回覆無法出席。若情況有變，歡迎直接聯繫我們");
      } else {
        setGuest(r);
        // 用 Phase 1（或先前 Phase 2）的資料預填
        setForm((f) => ({
          ...f,
          adult_count: r.adult_count || 1,
          child_count: r.child_count || 0,
          main_course: { ...f.main_course, ...(r.main_course || {}) },
          kids_meal_count: r.kids_meal_count || 0,
          baby_chair_count: r.baby_chair_count || 0,
          veg_type: r.veg_type || "無",
          dietary_note: r.dietary_note || "",
          remark: r.remark || "",
        }));
        setStep("form");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const doSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const c = contact.trim();
      await submitPhase2({ contact: isValidPhone(c) ? normalizePhone(c) : c, ...form });
      setStep("done");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container">
      <header className="hero-arch-card">
        <p className="script-title">Almost There</p>
        <p className="english-sub">Alan &amp; Omena</p>
        <div className="illustration-art-wrapper">
          <img src="/hero.png" alt="Alan & Omena" className="hero-image" />
        </div>
        <h1 className="main-title">婚宴出席確認與飲食調查</h1>
        <p className="invitation-quote">
          日期已確定，感謝您的出席！<br />
          請填寫以下細節，方便我們為您安排座位與餐點。
        </p>
      </header>

      {closed ? (
        <section className="section-card" style={{ textAlign: "center", padding: "40px 24px" }}>
          <div className="modal-icon" style={{ margin: "0 auto 16px" }}><CalendarX size={26} /></div>
          <h3 className="modal-title">婚宴出席確認與飲食調查已截止</h3>
          <p className="modal-desc" style={{ marginBottom: 0 }}>
            感謝大家的熱情回覆！<br />若仍需填寫或修改資料，請直接與我們聯繫。
          </p>
        </section>
      ) : (
      <>
      {step === "lookup" && (
        <form onSubmit={doLookup}>
          <section className="section-card">
            <div className="section-header">
              <div className="section-header-title"><Search size={18} /> 確認您的身分</div>
              <div className="section-header-en">Find Your RSVP</div>
            </div>
            <div className="form-group">
              <label className="required">請輸入第一階段填寫的 Email 或 電話</label>
              <EmailInput
                type="text"
                requireAt
                value={contact}
                onChange={(v) => { setContact(v); setError(""); }}
                placeholder="例如 you@email.com 或 0912345678"
                invalid={!!error}
              />
              <div className="helper-text">我們會用它找到您先前填寫的意願紀錄</div>
            </div>
            {error && <p style={{ color: "var(--rose-accent)", fontSize: 13.5, marginTop: 8 }}>{error}</p>}
          </section>
          <button type="submit" className="btn-submit" disabled={busy}>{busy ? "查詢中…" : <><Search size={17} /> 找到我的紀錄</>}</button>
          <p style={{ textAlign: "center", marginTop: 18, fontSize: 12.5, color: "var(--text-muted)" }}>
            還沒填第一階段？<a href="/" style={{ color: "var(--milk-tea-700)", fontWeight: 600 }}>先填出席意願 →</a>
          </p>
        </form>
      )}

      {step === "form" && guest && (
        <form onSubmit={doSubmit}>
          <section className="section-card">
            <p style={{ fontSize: 14, color: "var(--milk-tea-900)", marginBottom: 4 }}>
              哈囉，<strong>{guest.name}</strong>
            </p>
            {guest.details_completed && (
              <p style={{ fontSize: 12.5, color: "var(--text-muted)" }}>您先前已填過詳細資料，這次送出會更新內容。</p>
            )}
          </section>

          {/* 再次確認人數 */}
          <section className="section-card">
            <div className="section-header">
              <div className="section-header-title"><Users size={18} /> 再次確認人數</div>
              <div className="section-header-en">Confirm Party Size</div>
            </div>
            <div className="form-group grid-2">
              <div>
                <label className="required">大人人數（含自己）</label>
                <Select value={form.adult_count} onChange={(v) => set("adult_count", v)}
                  options={range(1, 10, (n) => `${n} 位`)} />
              </div>
              <div>
                <label>小孩人數</label>
                <Select value={form.child_count} onChange={(v) => set("child_count", v)}
                  options={range(0, 10, (n) => `${n} 位`)} />
              </div>
            </div>
          </section>

          {/* 選擇主餐 */}
          <section className="section-card">
            <div className="section-header">
              <div className="section-header-title"><Utensils size={18} /> 選擇主餐</div>
              <div className="section-header-en">Main Course</div>
            </div>
            <p className="helper-text" style={{ marginBottom: 14 }}>
              請依大人人數，填寫每種主餐各要幾份。（目前共 {mainTotal} 份 / 大人 {form.adult_count} 位）
            </p>
            {MAIN_DISHES.map((dish) => (
              <div className="form-group grid-2" key={dish} style={{ alignItems: "center", marginBottom: 12 }}>
                <label style={{ margin: 0 }}>{dish}</label>
                <Select value={form.main_course[dish]} onChange={(v) => setMain(dish, v)}
                  options={range(0, 10, (n) => `${n} 份`)} />
              </div>
            ))}
            <div className="form-group">
              <label>兒童餐點</label>
              <Select value={form.kids_meal_count} onChange={(v) => set("kids_meal_count", v)}
                options={range(0, 10, (n) => (n === 0 ? "不需要兒童餐點" : `需要 ${n} 份兒童餐點`))} />
              <div className="helper-text">如有小孩需要另外準備的兒童餐點，請在此填寫份數</div>
            </div>
          </section>

          {/* 座位需求 */}
          <section className="section-card">
            <div className="section-header">
              <div className="section-header-title"><Baby size={18} /> 座位需求</div>
              <div className="section-header-en">Seating</div>
            </div>
            <div className="form-group">
              <label>兒童座椅需求</label>
              <Select value={form.baby_chair_count} onChange={(v) => set("baby_chair_count", v)}
                options={range(0, 3, (n) => (n === 0 ? "不需要兒童座椅" : n === 3 ? "需要 3 張以上" : `需要 ${n} 張兒童座椅`))} />
            </div>
          </section>

          {/* 特殊飲食 */}
          <section className="section-card">
            <div className="section-header">
              <div className="section-header-title"><Salad size={18} /> 特殊飲食</div>
              <div className="section-header-en">Dietary</div>
            </div>
            <div className="form-group">
              <label>素食類型（若有選素食主餐）</label>
              <Select value={form.veg_type} onChange={(v) => set("veg_type", v)}
                options={[
                  { value: "無", label: "無" },
                  { value: "蛋奶素", label: "蛋奶素 (Lacto-Ovo)" },
                  { value: "全素/純素", label: "全素 / 純素 (Vegan)" },
                  { value: "鍋邊素", label: "鍋邊素" },
                ]} />
            </div>
            <div className="form-group">
              <label>食物過敏提醒</label>
              <input type="text" value={form.dietary_note} onChange={(e) => set("dietary_note", e.target.value)} placeholder="例如：海鮮過敏、不吃牛…" />
              <div className="helper-text">我們會特別請主廚於餐牌備註過敏原</div>
            </div>
          </section>

          {/* 備註 */}
          <section className="section-card">
            <div className="section-header">
              <div className="section-header-title"><PenLine size={18} /> 備註</div>
              <div className="section-header-en">Remark</div>
            </div>
            <div className="form-group">
              <label>其他想告訴我們的事</label>
              <textarea rows={3} value={form.remark} onChange={(e) => set("remark", e.target.value)} placeholder="例如：需要方便輪椅的座位、想跟某桌坐在一起…" />
            </div>
          </section>

          {error && <p style={{ color: "var(--rose-accent)", textAlign: "center", marginBottom: 12, fontSize: 13.5 }}>{error}</p>}
          <button type="submit" className="btn-submit" disabled={busy}>{busy ? "傳送中…" : <><Send size={17} /> 送出詳細資料</>}</button>
        </form>
      )}

      {step === "done" && (
        <section className="section-card" style={{ textAlign: "center", padding: "40px 24px" }}>
          <div className="modal-icon" style={{ margin: "0 auto 16px" }}><PartyPopper size={26} /></div>
          <h3 className="modal-title">已收到，感謝您！</h3>
          <p className="modal-desc" style={{ marginBottom: 0 }}>
            您的座位與餐飲細節我們已經記錄下來，期待與您相聚
          </p>
        </section>
      )}
      </>
      )}
    </div>
  );
}
