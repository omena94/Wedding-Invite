// 婚禮當天現場留言（2026-09-28）：賓客掃會場的 QR code 進來寫一句祝福，送出後會出現在會場大螢幕（/wall）。
// 不用登入、名字可不填；字數跟後端一樣限 60 字，大螢幕上才一眼讀得完。
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, MessageSquareHeart, PenLine, Send } from "lucide-react";
import { fetchStage, postWallMessage } from "../api.js";
import PreviewBanner from "../components/PreviewBanner.jsx";
import { GuestHeader, GuestNav, LoadError, useGuestLoad } from "../components/GuestUI.jsx";

const TEXT_MAX = 60;
const NAME_MAX = 20;
const NAME_KEY = "wedding_wish_name";
const DEVICE_KEY = "wedding_wish_device";

// 名字記在這支手機：當天可能會寫好幾則；上傳過照片的人也不用再打一次
function loadName() {
  try { return (localStorage.getItem(NAME_KEY) || localStorage.getItem("wedding_upload_name") || "").slice(0, NAME_MAX); } catch { return ""; }
}

// 限流看「這支手機」而不是 IP：會場 Wi-Fi、電信 NAT 會讓很多賓客共用同一個對外 IP。
// 代號隨機產生一次記在瀏覽器；存不了（隱私模式）就只在這次開頁有效。randomUUID 只有 HTTPS 才有，區網測試用備案
function loadDevice() {
  const make = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`);
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) { id = make(); localStorage.setItem(DEVICE_KEY, id); }
    return id;
  } catch { return make(); }
}

export default function Wish() {
  const { data: stage, error: stageError, retry } = useGuestLoad(fetchStage);
  const [name, setName] = useState(loadName);
  const [device] = useState(loadDevice);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(null); // 送出成功：{ status, name, text }
  const textRef = useRef(null);

  useEffect(() => { try { localStorage.setItem(NAME_KEY, name); } catch { /* 存不了就算了 */ } }, [name]);

  const submit = async (e) => {
    e.preventDefault();
    const msg = text.trim();
    if (!msg) { setError("先寫下想說的話再送出喔"); textRef.current?.focus(); return; }
    setBusy(true);
    setError("");
    try {
      const r = await postWallMessage(name.trim(), msg, device);
      setSent({ status: r.status, name: name.trim(), text: msg });
      setText("");
    } catch (err) {
      // 403（被關掉）、429（寫太快）、斷線都用後端或 api.js 給的白話訊息，留言內容留著可以再按一次
      setError(err.message || "送出失敗，請再試一次");
    } finally {
      setBusy(false);
    }
  };

  const again = () => {
    setSent(null);
    setError("");
    setTimeout(() => textRef.current?.focus(), 0);
  };

  const open = !!(stage && (stage.wall_open || stage.preview));

  return (
    <div className="container">
      <PreviewBanner stage={stage} closedLabels={stage && !stage.wall_open ? ["現場留言"] : []} />
      <GuestHeader title="現場留言給新人" subtitle="寫下你想對宣文和孟庭說的話，送出後會出現在會場的大螢幕上" />

      {stageError ? <LoadError error={stageError} retry={retry} /> : stage === null ? (
        <div className="loading">讀取中…</div>
      ) : !open ? (
        <section className="section-card" style={{ textAlign: "center" }}>
          <div className="section-header" style={{ justifyContent: "center" }}>
            <div className="section-header-title"><MessageSquareHeart size={18} /> 現場留言尚未開放</div>
          </div>
          <p style={{ fontSize: 14, lineHeight: 1.8 }}>婚禮當天會開放，到時候再來留言喔</p>
        </section>
      ) : sent ? (
        <section className="section-card guest-receipt" role="status">
          <div className="receipt-seal"><Check size={28} /></div>
          <h2>已送出！</h2>
          <p>{sent.status === "pending" ? "新人確認後就會出現在大螢幕上" : "抬頭看看大螢幕，幾秒後就會出現 ✨"}</p>
          <blockquote className="wish-quote">
            <p>{sent.text}</p>
            <footer>— {sent.name || "一位賓客"}</footer>
          </blockquote>
          <button type="button" className="btn-submit" onClick={again}><PenLine size={20} /> 再寫一則</button>
        </section>
      ) : (
        <form className="section-card" onSubmit={submit}>
          <div className="section-header">
            <div className="section-header-title"><MessageSquareHeart size={18} /> 寫下祝福</div>
            <div className="section-header-en">Wishes</div>
          </div>
          <div className="form-group">
            <label htmlFor="wish-name">你的名字（會顯示在螢幕上，可不填）</label>
            <input id="wish-name" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="不填就顯示「一位賓客」" maxLength={NAME_MAX} autoComplete="name" />
          </div>
          <div className="form-group">
            <label htmlFor="wish-text">想說的話</label>
            {/* 大螢幕上只顯示一行一行的字，換行一律變成空格，送出前看到的就是螢幕上的樣子 */}
            <textarea id="wish-text" ref={textRef} rows={3} value={text} maxLength={TEXT_MAX}
              onChange={(e) => { setText(e.target.value.replace(/[\r\n]+/g, " ")); if (error) setError(""); }}
              placeholder="例如：新婚快樂！要一直這麼幸福喔" aria-describedby="wish-count" />
            <div id="wish-count" className={`wish-count${text.length >= TEXT_MAX ? " full" : ""}`}>{text.length} / {TEXT_MAX}</div>
          </div>
          {error && <p className="field-error wish-error" role="alert">{error}</p>}
          <button type="submit" className="btn-submit wish-send" disabled={busy}>
            <Send size={20} /> {busy ? "送出中…" : "送出祝福"}
          </button>
          <p className="helper-text" style={{ textAlign: "center", marginTop: 10 }}>一則最多 {TEXT_MAX} 個字，想說的很多可以分成好幾則。</p>
        </form>
      )}

      <p className="footnote"><a href="/" className="top-link"><ArrowLeft size={14} /> 回首頁</a></p>
      <GuestNav />
    </div>
  );
}
