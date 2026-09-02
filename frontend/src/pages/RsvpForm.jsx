import { useEffect, useState } from "react";
import { User, CalendarCheck, Mail, Users, MessageCircle, Calendar, MapPin, Send, Heart, CalendarX, Mars, Venus, Clock, SquareParking } from "lucide-react";
import Select, { range } from "../components/Select.jsx";
import EmailInput from "../components/EmailInput.jsx";
import { fetchConfig, submitPhase1 } from "../api.js";

const initial = {
  name: "",
  side: "groom",
  attending: true,
  email: "",
  phone: "",
  date_preference: "both",
  adult_count: 1,
  child_count: 0,
  message: "",
};

export default function RsvpForm() {
  const [form, setForm] = useState(initial);
  const [submitting, setSubmitting] = useState(false);
  const [modal, setModal] = useState(null); // null | "yes" | "no"
  const [error, setError] = useState("");
  const [closed, setClosed] = useState(false); // 是否已過截止日

  useEffect(() => {
    fetchConfig()
      .then((c) => setClosed(!c.phase1_open))
      .catch(() => {}); // 查不到設定時照常開放
  }, []);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!form.name.trim()) return setError("請填寫您的姓名");
    if (form.attending && (!form.email.trim() || !form.phone.trim()))
      return setError("出席者請留下 Email 與電話，方便後續寄送詳細通知");

    setSubmitting(true);
    try {
      const payload = { ...form, name: form.name.trim(), email: form.email.trim(), phone: form.phone.trim() };
      if (!form.attending) { payload.email = form.email.trim(); payload.phone = form.phone.trim(); }
      await submitPhase1(payload);
      setModal(form.attending ? "yes" : "no");
      setForm(initial);
    } catch (err) {
      setError(err.message || "送出失敗，請稍後再試");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="container">
      <header className="hero-arch-card">
        <p className="script-title">We're Married</p>
        <p className="english-sub">Alan &amp; Omena</p>

        <div className="illustration-art-wrapper">
          <img src="/hero.png" alt="Alan & Omena" className="hero-image" />
        </div>

        <h1 className="main-title">出席意願調查</h1>
        <p className="announce-lead">最愛的家人與好友們~~</p>
        <p className="announce-title">宣文與孟庭 要結婚啦</p>
        <p className="invitation-quote">
          先調查大家的出席意願來安排舒服的場地<br />
          待日期場地敲定後，會再將詳細資訊雙手奉上<br />
          期待與你們見面喔!!!
        </p>

        <div className="event-details-card">
          <div className="detail-item">
            <div className="detail-icon"><Calendar size={16} /></div>
            <div className="detail-content"><strong>日期：</strong>2027.03.06（週六） 或　2027.03.13（週六）</div>
          </div>
          <div className="detail-item">
            <div className="detail-icon"><Clock size={16} /></div>
            <div className="detail-content"><strong>時間：</strong>12:00</div>
          </div>
          <div className="detail-item">
            <div className="detail-icon"><MapPin size={16} /></div>
            <div className="detail-content">
              <strong>地點：</strong>
              <a
                href="https://maps.app.goo.gl/oLUTYpC5Czfo5SZD6"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "var(--milk-tea-700)", fontWeight: 500, textDecoration: "underline", textUnderlineOffset: 3 }}
              >
                台北美福大飯店（台北市中山區樂群二路55號）
              </a>
            </div>
          </div>
          <div className="detail-item">
            <div className="detail-icon"><SquareParking size={16} /></div>
            <div className="detail-content">
              <strong>停車：</strong>
              <a
                href="https://maps.app.goo.gl/JdHCL5tFBmSuWxeJ9"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "var(--milk-tea-700)", fontWeight: 500, textDecoration: "underline", textUnderlineOffset: 3 }}
              >
                停車場資訊
              </a>
            </div>
          </div>
        </div>
      </header>

      {closed ? (
        <section className="section-card" style={{ textAlign: "center", padding: "40px 24px" }}>
          <div className="modal-icon" style={{ margin: "0 auto 16px" }}><CalendarX size={26} /></div>
          <h3 className="modal-title">出席意願調查已截止</h3>
          <p className="modal-desc" style={{ marginBottom: 0 }}>
            感謝大家的熱情回覆！<br />若仍需填寫或修改資料，請直接與我們聯繫。
          </p>
        </section>
      ) : (
      <form onSubmit={onSubmit}>
        {/* 基本資料 */}
        <section className="section-card">
          <div className="section-header">
            <div className="section-header-title"><User size={18} /> 基本資料</div>
            <div className="section-header-en">Guest Profile</div>
          </div>

          <div className="form-group">
            <label className="required">您的姓名</label>
            <input type="text" value={form.name} onChange={(e) => set("name", e.target.value)} required />
          </div>

          <div className="form-group">
            <label className="required">您是哪一方的親友？</label>
            <div className="radio-grid">
              <div className="radio-card">
                <input type="radio" name="side" checked={form.side === "groom"} onChange={() => set("side", "groom")} />
                <div className="radio-box"><Mars size={16} /><span>男方親友</span></div>
              </div>
              <div className="radio-card">
                <input type="radio" name="side" checked={form.side === "bride"} onChange={() => set("side", "bride")} />
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
                <input type="radio" name="attending" checked={form.attending === true} onChange={() => set("attending", true)} />
                <div className="radio-box"><span>Yes 期待出席</span></div>
              </div>
              <div className="radio-card">
                <input type="radio" name="attending" checked={form.attending === false} onChange={() => set("attending", false)} />
                <div className="radio-box"><span>No 無法出席</span></div>
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
                  <label className="required">聯絡 Email</label>
                  <EmailInput value={form.email} onChange={(v) => set("email", v)} />
                  <div className="helper-text">詳細資料將寄送至此</div>
                </div>
                <div>
                  <label className="required">聯絡電話</label>
                  <input type="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
                </div>
              </div>
            </section>

            {/* 日期與人數 */}
            <section className="section-card">
              <div className="section-header">
                <div className="section-header-title"><Users size={18} /> 日期與人數</div>
                <div className="section-header-en">Date &amp; Party Size</div>
              </div>

              <div className="form-group">
                <label className="required">目前規劃的日期，哪一天比較方便？</label>
                <Select
                  value={form.date_preference}
                  onChange={(v) => set("date_preference", v)}
                  options={[
                    { value: "both", label: "2027.03.06（週六） 與 2027.03.13（週六） 都可以" },
                    { value: "0306", label: "2027.03.06（週六）" },
                    { value: "0313", label: "2027.03.13（週六）" },
                  ]}
                />
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
          </>
        )}

        {/* 想說的話 */}
        <section className="section-card">
          <div className="section-header">
            <div className="section-header-title"><MessageCircle size={18} /> 想說的話</div>
            <div className="section-header-en">Message for Us</div>
          </div>
          <div className="form-group">
            <textarea rows={3} value={form.message} onChange={(e) => set("message", e.target.value)} />
          </div>
        </section>

        {error && <p style={{ color: "var(--rose-accent)", textAlign: "center", marginBottom: 12, fontSize: 13.5 }}>{error}</p>}

        <button type="submit" className="btn-submit" disabled={submitting}>
          {submitting ? "傳送中…" : <><Send size={17} /> 送出出席意願</>}
        </button>
      </form>
      )}

      {modal && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-icon"><Heart size={28} /></div>
            <h3 className="modal-title">感謝您的回覆！</h3>
            <p className="modal-desc">
              {modal === "no"
                ? "感謝您的暖心祝福！雖然這次無法前來，這份心意我們都好好收下囉"
                : "我們已收到您的出席意願！待最終日期敲定後，我們會再寄送詳細資訊給您。"}
            </p>
            <button className="modal-btn" onClick={() => setModal(null)}>好的</button>
          </div>
        </div>
      )}
    </div>
  );
}
