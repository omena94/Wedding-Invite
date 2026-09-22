import { GuestHeader, GuestNav, LoadError, useGuestLoad, GuestReceipt, useDraft } from '../components/GuestUI.jsx';
import { useEffect, useState } from "react";
import Swal from "sweetalert2";
import { Search, Users, Utensils, Baby, Salad, PenLine, Send, PartyPopper, Ruler, Leaf } from "lucide-react";
import Select, { range } from "../components/Select.jsx";
import EmailInput from "../components/EmailInput.jsx";
import PreviewBanner from "../components/PreviewBanner.jsx";
import { fetchStage, lookupRsvp, submitPhase2, requestVerification, verifyGuest } from "../api.js";
import { fmtDateTime } from "../constants.js";
import { isValidEmail, isValidPhone, normalizePhone } from "../validators.js";

// 主餐選項（要改直接改這裡）
const MAIN_DISHES = ["牛排", "雞腿排", "鮭魚排", "素食"];

export default function DetailsForm() {
  const [step, setStep] = useState("lookup"); // lookup | form | done
  const [contact, setContact] = useState("");
  const [guest, setGuest] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const {data:stage,error:stageError,retry} = useGuestLoad(fetchStage);
  const [access,setAccess]=useState(() => new URLSearchParams(location.hash.slice(1)).get('access')||'');
  const [challenge,setChallenge]=useState('');
  const [code,setCode]=useState('');
  const [receipt,setReceipt]=useState(null);
  useEffect(()=>{if(location.hash.startsWith('#access=')) history.replaceState(null,'',location.pathname);},[]);

  const [form, setForm, draft] = useDraft(guest ? `wedding-details-${guest.public_id}` : null, {
    adult_count: 1,
    child_count: 0,
    main_course: Object.fromEntries(MAIN_DISHES.map((d) => [d, 0])),
    kids_meal_count: 0,
    baby_chair_count: 0,
    veg_type: "無",
    dietary_note: "",
    remark: "",
    children: [],   // 每個小孩的身高 [{height: "95"}]
  });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setMain = (dish, v) =>
    setForm((f) => ({ ...f, main_course: { ...f.main_course, [dish]: v } }));
  const setChild = (i, height) =>
    setForm((f) => {
      const arr = [...(f.children || [])];
      while (arr.length <= i) arr.push({ height: "" });
      arr[i] = { ...arr[i], height };
      return { ...f, children: arr };
    });

  const mainTotal = Object.values(form.main_course).reduce((a, b) => a + (b || 0), 0);
  const mainRemaining = Math.max(0, form.adult_count - mainTotal); // 主餐剩餘可選份數

  const doLookup = async (e) => {
    e.preventDefault();
    if(busy)return;
    setError("");
    const c = contact.trim();
    if (!access && !c) return setError("請輸入您第一階段填寫的 Email 或電話");
    if (!access && !isValidEmail(c) && !isValidPhone(c))
      return setError("格式不正確，請輸入有效的 Email 或 09 開頭的 10 碼手機號碼");
    setBusy(true);
    try {
      let token=access;
      if (!stage.preview && !token) {
        if (!challenge) { const r=await requestVerification(isValidPhone(c)?normalizePhone(c):c);setChallenge(r.challenge_id);return; }
        token=(await verifyGuest(challenge,code)).access_token;setAccess(token);
      }
      const r = await lookupRsvp(isValidPhone(c) ? normalizePhone(c) : c, token);
      if (!r.found) {
        setError("找不到您的意願調查紀錄。請確認 Email／電話與第一階段相同，或先完成第一階段。");
      } else if (!r.attending) {
        setError("您先前回覆無法出席。若情況有變，歡迎直接聯繫我們");
      } else {
        setGuest(r);
        setAccess(r.access_token);
        // 用 Phase 1（或先前 Phase 2）的資料預填
        setForm((f) => ({
          ...f,
          adult_count: r.adult_count || 1,
          child_count: r.child_count || 0,
          main_course: { ...Object.fromEntries(MAIN_DISHES.map(d=>[d,0])), ...(r.main_course || {}) },
          kids_meal_count: r.kids_meal_count || 0,
          baby_chair_count: r.baby_chair_count || 0,
          veg_type: r.veg_type || "無",
          dietary_note: r.dietary_note || "",
          remark: r.remark || "",
          children: Array.from({ length: r.child_count || 0 }, (_, i) => ({
            height: r.children && r.children[i] && r.children[i].height != null ? String(r.children[i].height) : "",
          })),
        }));
        setStep("form");
      }
    } catch (err) {
      setError(err.message);
      if(err.status===401){setAccess('');setChallenge('');setCode('');}
    } finally {
      setBusy(false);
    }
  };

  const doSubmit = async (e) => {
    e.preventDefault();
    if(busy)return;
    setError("");
    if (mainTotal !== form.adult_count) {
      return setError(`主餐總份數（${mainTotal}）須等於大人人數（${form.adult_count}），請為每位大人選一份主餐`);
    }
    if (form.kids_meal_count > form.child_count) {
      return setError(`兒童餐點份數（${form.kids_meal_count}）超過小孩人數（${form.child_count}），請調整`);
    }
    if(form.baby_chair_count>form.child_count)return setError('兒童椅數量不可超過小孩人數，請調整後再送出');
    setBusy(true);
    try {
      const c = contact.trim();
      const children = Array.from({ length: form.child_count }, (_, i) => {
        const h = form.children && form.children[i] ? String(form.children[i].height || "").trim() : "";
        return { height: h === "" ? null : parseInt(h, 10) };
      });
      const bad = children.find((k) => k.height !== null && (k.height < 40 || k.height > 200));
      if (bad) { setBusy(false); return setError("小孩身高請填 40～200 公分之間的數字（大概就好）"); }
      setReceipt(await submitPhase2({ access_token: access, ...form, children }));
      draft.clear();
      setStep('done');
    } catch (err) {
      setError(err.message);
      if(err.status===401){setAccess('');setChallenge('');setCode('');setGuest(null);setStep('lookup');}
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container">
      <GuestHeader title="入席 ‧ 共赴美好時光" subtitle="核對邀請資訊，確認同行人數、主餐與特殊飲食需求" brush/>

      <>{stageError?<LoadError error={stageError} retry={retry}/>:!stage&&<div className="loading" role="status">讀取回覆開放時間…</div>}</>
      <PreviewBanner stage={stage} closedLabels={stage && !stage.phase2_open ? ["第二階段"] : []}
        note="在這裡送出的資料會真的存進賓客名單，測試完記得到後台改回來" />
      {step === "lookup" && stage && !stage.phase2_open && !stage.preview && (
        <section className="section-card" style={{ textAlign: "center" }}>
          <div className="section-header" style={{ justifyContent: "center" }}>
            <div className="section-header-title">第二階段尚未開放</div>
          </div>
          <p style={{ fontSize: 14, lineHeight: 1.8 }}>
            {stage.phase2_open_at ? <>預計 <strong>{fmtDateTime(stage.phase2_open_at)}</strong> 開放，</> : null}
            收到我們的通知後再回來確認出席與主餐就可以囉
          </p>
          <p style={{ marginTop: 14 }}><a href="/" style={{ color: "var(--milk-tea-700)", fontWeight: 600 }}>← 回首頁</a></p>
        </section>
      )}
      {step === "lookup" && stage && (stage.phase2_open || stage.preview) && (
        <form onSubmit={doLookup}>
          {access && <p className="draft-notice">已讀取您的專屬回覆連結，按下方按鈕繼續。</p>}
          <section className="section-card">
            <div className="section-header">
              <div className="section-header-title"><Search size={18} /> 確認您的身分</div>
              <div className="section-header-en">Find Your RSVP</div>
            </div>
            {!access&&<div className="form-group">
              <label htmlFor="guest-contact" className="required">請輸入第一階段填寫的 Email 或 電話</label>
              <EmailInput id="guest-contact"
                disabled={busy}
                type="text"
                requireAt
                value={contact}
                onChange={(v) => { setContact(v); setError(""); setChallenge(""); setCode(""); }}
                placeholder="例如 you@email.com 或 0912345678"
                invalid={!!error}
              />
              <div className="helper-text">驗證碼會寄到您原先填寫的 Email，完成驗證後即可修改回覆</div>
            </div>}
            {challenge && <div className="form-group"><label htmlFor="guest-code">Email 中的 6 位驗證碼</label><input id="guest-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,''))}/><button type="button" className="btn" disabled={busy} onClick={()=>{setChallenge('');setCode('');}}>重新取得驗證碼</button><p className="helper-text">10 分鐘內有效，請一併檢查垃圾郵件匣。</p></div>}
            {error && <p role="alert" style={{ color: "var(--rose-accent)", fontSize: 13.5, marginTop: 8 }}>{error}</p>}
          </section>
          <button type="submit" className="btn-submit" disabled={busy}>{busy ? "查詢中…" : <><Search size={17} /> {access||stage.preview?'開啟我的回覆':challenge?'驗證並繼續':'寄送驗證碼'}</>}</button>
          <p style={{ textAlign: "center", marginTop: 18, fontSize: 12.5, color: "var(--text-muted)" }}>
            還沒填第一階段？<a href="/rsvp" style={{ color: "var(--milk-tea-700)", fontWeight: 600 }}>先填出席意願 →</a>
          </p>
        </form>
      )}

      {step === "form" && guest && (
        <form onSubmit={doSubmit}>
          {draft.restored && <p className="draft-notice">已恢復這個分頁未送出的餐點回覆。</p>}
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
                <Select aria-label="大人人數（含自己）" value={form.adult_count} onChange={(v) => set("adult_count", v)}
                  options={range(1, 50, (n) => `${n} 位`)} />
              </div>
              <div>
                <label>小孩人數</label>
                <Select aria-label="小孩人數" value={form.child_count} onChange={(v) => set("child_count", v)}
                  options={range(0, 50, (n) => `${n} 位`)} />
              </div>
            </div>
          </section>

          {/* 小孩身高（後台依此估算餐費，頁面上不說明收費方式） */}
          {form.child_count > 0 && (
            <section className="section-card">
              <div className="section-header">
                <div className="section-header-title"><Ruler size={18} /> 小孩身高</div>
                <div className="section-header-en">Kids Height</div>
              </div>
              {/* 2026-09-09 新人要求：不跟賓客解釋飯店依身高收費，只請他們填身高 */}
              <p className="helper-text" style={{ marginBottom: 14 }}>
                請填寫孩子的實際身高
              </p>
              {Array.from({ length: form.child_count }, (_, i) => (
                <div className="form-group grid-2" key={i} style={{ alignItems: "center", marginBottom: 12 }}>
                  <label style={{ margin: 0 }}>小孩 {i + 1} 身高（公分）</label>
                  <input aria-label={`小孩 ${i+1} 身高公分`} type="text" inputMode="numeric" placeholder="例如 95"
                    value={(form.children && form.children[i] && form.children[i].height) || ""}
                    onChange={(e) => setChild(i, e.target.value.replace(/[^\d]/g, "").slice(0, 3))} />
                </div>
              ))}
            </section>
          )}

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
              const maxSel = Math.min(50, Math.max(cur, cur + mainRemaining));
              return (
                <div className="form-group grid-2" key={dish} style={{ alignItems: "center", marginBottom: 12 }}>
                  <label style={{ margin: 0 }}>{dish}</label>
                  <Select aria-label={dish} value={cur} onChange={(v) => setMain(dish, v)}
                    options={range(0, maxSel, (n) => `${n} 份`)} />
                </div>
              );
            })}
            {/* 跟上面的主餐同一種排法：名稱在左、下拉在右同寬（2026-09-22 新人要求） */}
            <div className="form-group grid-2" style={{ alignItems: "center", marginBottom: 12 }}>
              <label style={{ margin: 0 }}>兒童餐點</label>
              <Select aria-label="兒童餐點" value={form.kids_meal_count} onChange={(v) => set("kids_meal_count", v)}
                options={range(0, Math.min(50, Math.max(form.kids_meal_count || 0, form.child_count)), (n) => (n === 0 ? "不需要" : `${n} 份`))} />
            </div>
            <div className="helper-text" style={{ marginTop: -4 }}>
              依小孩人數填寫，最多 {form.child_count} 份；若無需求也沒關係，現場自助吧的餐點小孩皆可享用
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
              <Select aria-label="兒童座椅需求" value={form.baby_chair_count} onChange={(v) => set("baby_chair_count", v)}
                options={range(0, Math.max(form.child_count,form.baby_chair_count), n=>n===0?"不需要兒童座椅":`需要 ${n} 張兒童座椅`)} />
            </div>
          </section>

          {/* 特殊飲食 */}
          <section className="section-card">
            <div className="section-header">
              <div className="section-header-title"><Salad size={18} /> 特殊飲食</div>
              <div className="section-header-en">Dietary</div>
            </div>
            {/* 2026-09-22 新人決定素食一律全素，不再問素食類型；改成說明，餐檯有標示食材可自行取用 */}
            <div className="veg-note" role="note">
              <div className="veg-note-title"><Leaf size={15} /> 關於素食餐點</div>
              <p>素食套餐一律為<strong>全素</strong>。自助餐檯的每道餐點都會標示食材，若有符合您飲食習慣的餐點，也歡迎自行取用。</p>
            </div>
            <div className="form-group">
              <label>食物過敏提醒</label>
              <input type="text" aria-label="食物過敏提醒" value={form.dietary_note} onChange={(e) => set("dietary_note", e.target.value)} placeholder="例如：海鮮過敏、不吃牛…" />
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
              <textarea aria-label="其他想告訴我們的事" rows={3} value={form.remark} onChange={(e) => set("remark", e.target.value)} />
            </div>
          </section>

          {error && <p role="alert" style={{ color: "var(--rose-accent)", textAlign: "center", marginBottom: 12, fontSize: 13.5 }}>{error}</p>}
          <button type="submit" className="btn-submit" disabled={busy}>{busy ? "傳送中…" : <><Send size={17} /> 送出詳細資料</>}</button>
        </form>
      )}

      {step === "done" && receipt && <GuestReceipt receipt={receipt}/>}
      <GuestNav/>
    </div>
  );
}
