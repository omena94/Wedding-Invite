import { GuestHeader, GuestNav, LoadError, useGuestLoad, GuestReceipt, useDraft } from '../components/GuestUI.jsx';
import { useState } from "react";
import Swal from "sweetalert2";
import { User, CalendarCheck, Mail, Users, MessageCircle, Calendar, MapPin, Send, Mars, Venus, Clock, SquareParking } from "lucide-react";
import Select, { range } from "../components/Select.jsx";
import EmailInput from "../components/EmailInput.jsx";
import { submitPhase1 } from "../api.js";
import { nameError, emailError, phoneError, normalizePhone } from "../validators.js";

const initial = {
  name: "",
  side: "groom",
  attending: true,
  email: "",
  phone: "",
  date_preference: "0313", // 日期已定案 2027.03.13

  adult_count: 1,
  child_count: 0,
  message: "",
};

export default function RsvpForm() {
  const [form, setForm, draft] = useDraft('wedding-rsvp-draft', initial);
  const [receipt, setReceipt] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({}); // 各欄位驗證錯誤

  const set = (k, v) => {
    setForm((f) => ({ ...f, [k]: v }));
    // 使用者修改欄位時，清掉該欄位的錯誤提示
    setFieldErrors((fe) => (fe[k] ? { ...fe, [k]: "" } : fe));
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    if(submitting)return;
    setError("");

    // 逐欄驗證（Email/電話僅在「出席」時必填）
    const errs = {
      name: nameError(form.name),
      email: form.attending ? emailError(form.email) : (form.email.trim() ? emailError(form.email, false) : ""),
      phone: form.attending ? phoneError(form.phone) : (form.phone.trim() ? phoneError(form.phone, false) : ""),
    };
    if (errs.name || errs.email || errs.phone) {
      setFieldErrors(errs);
      setError("請檢查紅框欄位的內容");
      requestAnimationFrame(() => document.querySelector(".input-error")?.focus());
      return;
    }
    setFieldErrors({});

    setSubmitting(true);
    try {
      const payload = {
        ...form,
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        phone: normalizePhone(form.phone),
      };
      setReceipt(await submitPhase1(payload));
      draft.clear();
    } catch (err) {
      if (err.status === 409) {
        // 重複填寫 → SweetAlert 提示
        Swal.fire({
          icon: "warning",
          title: "您已經填過囉！",
          text: "如果需要修改內容，請直接聯繫宣文或孟庭",
          confirmButtonText: "好的",
          confirmButtonColor: "#B28F70",
        });
      } else {
        setError(err.message || "送出失敗，請稍後再試");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="container">
      <GuestHeader title="把這一天，留給我們" subtitle="2027.03.13 · 台北美福 2F 大宴會廳"/>

      {receipt ? <GuestReceipt receipt={receipt}/> : <form onSubmit={onSubmit} noValidate>
        {draft.restored && <p className="draft-notice">已恢復這個分頁尚未送出的回覆。草稿保留 24 小時。</p>}
        {/* 基本資料 */}
        <section className="section-card">
          <div className="section-header">
            <div className="section-header-title"><User size={18} /> 基本資料</div>
            <div className="section-header-en">Guest Profile</div>
          </div>

          <div className="form-group">
            <label htmlFor="rsvp-name" className="required">您的姓名</label>
            <input
              type="text" id="rsvp-name" autoComplete="name" aria-invalid={!!fieldErrors.name}
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              className={fieldErrors.name ? "input-error" : undefined}
              required
            />
            {fieldErrors.name && <div className="field-error">{fieldErrors.name}</div>}
          </div>

          <div className="form-group">
            <label className="required">您是哪一方的親友？</label>
            <div className="radio-grid">
              <div className="radio-card">
                <input type="radio" name="side" aria-label="男方親友" checked={form.side === "groom"} onChange={() => set("side", "groom")} />
                <div className="radio-box"><Mars size={16} /><span>男方親友</span></div>
              </div>
              <div className="radio-card">
                <input type="radio" name="side" aria-label="女方親友" checked={form.side === "bride"} onChange={() => set("side", "bride")} />
                <div className="radio-box"><Venus size={16} /><span>女方親友</span></div>
              </div>
            </div>
          </div>
        </section>

        {/* 出席意願 */}
        <section className="section-card">
          <div className="section-header">
            <div className="section-header-title"><CalendarCheck size={18} /> 出席意願</div>
            <div className="section-header-en">Attendance</div>
          </div>
          <div className="form-group">
            <label className="required">是否能來參加？</label>
            <div className="radio-grid">
              <div className="radio-card">
                <input type="radio" name="attending" aria-label="期待出席" checked={form.attending === true} onChange={() => set("attending", true)} />
                <div className="radio-box"><span>Yes　期待出席</span></div>
              </div>
              <div className="radio-card">
                <input type="radio" name="attending" aria-label="不克前往" checked={form.attending === false} onChange={() => set("attending", false)} />
                <div className="radio-box"><span>No　不克前往</span></div>
              </div>
            </div>
          </div>
        </section>

        {form.attending && (
          <>
            {/* 聯絡方式 */}
            <section className="section-card">
              <div className="section-header">
                <div className="section-header-title"><Mail size={18} /> 聯絡方式</div>
                <div className="section-header-en">Contact</div>
              </div>
              <div className="form-group grid-2">
                <div>
                  <label htmlFor="rsvp-email" className="required">聯絡 Email</label>
                  <EmailInput id="rsvp-email" value={form.email} onChange={(v) => set("email", v)} invalid={!!fieldErrors.email} />
                  {fieldErrors.email
                    ? <div className="field-error">{fieldErrors.email}</div>
                    : <div className="helper-text">詳細資料將寄送至此</div>}
                </div>
                <div>
                  <label htmlFor="rsvp-phone" className="required">聯絡電話</label>
                  <input
                    type="tel" id="rsvp-phone" autoComplete="tel" aria-invalid={!!fieldErrors.phone}
                    inputMode="tel"
                    placeholder="0912345678"
                    value={form.phone}
                    onChange={(e) => set("phone", e.target.value)}
                    className={fieldErrors.phone ? "input-error" : undefined}
                  />
                  {fieldErrors.phone && <div className="field-error">{fieldErrors.phone}</div>}
                </div>
              </div>
            </section>

            {/* 日期與人數 */}
            <section className="section-card">
              <div className="section-header">
                <div className="section-header-title"><Users size={18} /> 出席人數</div>
                <div className="section-header-en">Party Size</div>
              </div>

              <p className="helper-text" style={{ marginTop: -6, marginBottom: 16 }}>
                此階段人數只是先預估，待統計好會再與您進行最後的確認
              </p>

              <div className="form-group grid-2">
                <div>
                  <label className="required">大人人數（含自己）</label>
                  <Select aria-label="大人人數（含自己）" value={form.adult_count} onChange={(v) => set("adult_count", v)}
                    options={range(1, 10, (n) => `${n} 位`)} />
                </div>
                <div>
                  <label>小孩人數</label>
                  <Select aria-label="小孩人數" value={form.child_count} onChange={(v) => set("child_count", v)}
                    options={range(0, 10, (n) => `${n} 位`)} />
                </div>
              </div>
            </section>
          </>
        )}

        {/* 想說的話 */}
        <section className="section-card">
          <div className="section-header">
            <div className="section-header-title"><MessageCircle size={18} /> 想說的話</div>
            <div className="section-header-en">Message for Us</div>
          </div>
          <div className="form-group">
            <textarea aria-label="想對新人說的話" rows={3} value={form.message} onChange={(e) => set("message", e.target.value)} />
          </div>
        </section>

        {error && <p role="alert" style={{ color: "var(--rose-accent)", textAlign: "center", marginBottom: 12, fontSize: 13.5 }}>{error}</p>}

        <button type="submit" className="btn-submit" disabled={submitting}>
          {submitting ? "傳送中…" : <><Send size={17} /> 送出出席意願</>}
        </button>
      </form>}

      <GuestNav/>
    </div>
  );
}
