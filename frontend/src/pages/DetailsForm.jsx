import { useEffect, useState } from "react";
import Swal from "sweetalert2";
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
  const mainRemaining = Math.max(0, form.adult_count - mainTotal); // 主餐剩餘可選份數

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
    if (mainTotal > form.adult_count) {
      return setError(`主餐總份數（${mainTotal}）超過大人人數（${form.adult_count}），請調整主餐選擇`);
    }
    if (form.kids_meal_count > form.child_count) {
      return setError(`兒童餐點份數（${form.kids_meal_count}）超過小孩人數（${form.child_count}），請調整`);
    }
    setBusy(true);
    try {
      const c = contact.trim();
      await submitPhase2({ contact: isValidPhone(c) ? normalizePhone(c) : c, ...form });
      Swal.fire({
        icon: "success",
        title: "已收到，感謝您！",
        text: "您的座位與餐飲細節我們已經記錄下來，期待與您相聚",
        confirmButtonText: "好的",
        confirmButtonColor: "#B28F70",
      });
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
        <p className="script-title">See You at the Table</p>
        <p className="english-sub">Alan &amp; Omena</p>
        <div className="illustration-art-wrapper hero-swap">
          <img src="/hero-line.png" alt="Alan & Omena" className="hero-image" />
          <img src="/hero.png" alt="Alan & Omena" className="hero-image hero-swap-back" />
        </div>
        <h1 className="main-title">來跟我們一起吃飯！</h1>
        <p className="main-subtitle">出席與主餐調查</p>
        <p className="invitation-quote" style={{ marginBottom: 12 }}>
          {step === "done" ? (
            <>
              都收到囉！謝謝你的回覆<br />
              你的主餐與細節我們都記下來了<br />
              期待與你一起大吃一頓
            </>
          ) : (
            <>
              耶！一切終於搞定囉，準備好來跟我們大吃一頓了嗎？<br />
              請幫我們確認最終出席人數、挑選你的專屬主餐<br />
              如果有過敏的食材也一定要跟我們說唷
            </>
          )}
        </p>
        <p className="announce-title">我們3/13見！</p>
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
              請依大人人數，填寫每種主餐各要幾份。（已選 {mainTotal} / {form.adult_count} 份
              {mainRemaining > 0
                ? `，還可選 ${mainRemaining} 份`
                : "，已選滿；若要更換請先減少原本選定的餐點"}）
            </p>
            {MAIN_DISHES.map((dish) => {
              const cur = form.main_course[dish] || 0;
              // 已選滿時只能維持或減少；有剩餘額度才能往上加
              const maxSel = Math.min(10, Math.max(cur, cur + mainRemaining));
              return (
                <div className="form-group grid-2" key={dish} style={{ alignItems: "center", marginBottom: 12 }}>
                  <label style={{ margin: 0 }}>{dish}</label>
                  <Select value={cur} onChange={(v) => setMain(dish, v)}
                    options={range(0, maxSel, (n) => `${n} 份`)} />
                </div>
              );
            })}
            <div className="form-group">
              <label>兒童餐點</label>
              <Select value={form.kids_meal_count} onChange={(v) => set("kids_meal_count", v)}
                options={range(0, Math.min(10, Math.max(form.kids_meal_count || 0, form.child_count)), (n) => (n === 0 ? "不需要兒童餐點" : `需要 ${n} 份兒童餐點`))} />
              <div className="helper-text">
                依小孩人數填寫，最多 {form.child_count} 份；若無需求也沒關係，現場自助吧的餐點小孩皆可享用
              </div>
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
              <textarea rows={3} value={form.remark} onChange={(e) => set("remark", e.target.value)} />
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
