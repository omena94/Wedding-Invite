// 婚禮當天要帶的東西（2026-10-01）：依分類列出要帶的物品，每樣可寫數量、誰負責帶、備註，收進包包就勾「已備妥」。
// 前一晚對著清單收、當天出門前再看一次；演練完要重新收一次可以按「全部重來」。
import { useMemo, useState } from "react";
import { ListPlus, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import Select from "../components/Select.jsx";
import { Checkbox } from "../components/Toggle.jsx";
import { bulkPacking, createPackingItem, deletePackingItem, fetchPacking, importPacking, updatePackingItem } from "../api.js";
import { Empty, ErrorBox, Field, Loading, Modal, NumberInput, PageHead, confirmAsk, confirmDelete, toastErr, toastOk, useLoader } from "./ui.jsx";

// 內建分類的顯示順序；自訂的排在後面
const CATEGORIES = ["證件與禮金", "新娘", "新郎", "儀式與佈置", "招待桌", "大螢幕與音響", "急救小物", "其他"];
const CUSTOM = "__custom__";
const NO_OWNER = "__none__";

// 「帶入常用清單」：台灣婚宴常見要帶的東西，帶入後再自己刪改；同分類同名的不會重複帶入
const PRESET = {
  "證件與禮金": ["結婚書約", "身分證", "印章", "紅包袋", "零錢與小鈔", "飯店尾款（現金或支票）", "飯店合約"],
  "新娘": ["婚紗與禮服", "高跟鞋", "平底鞋（換穿用）", "頭飾與耳環", "隱形內衣與安全褲", "補妝包", "手機與充電器"],
  "新郎": ["西裝", "襯衫", "領結或領帶", "皮鞋", "袖扣", "胸花"],
  "儀式與佈置": ["婚戒", "捧花", "婚紗照與相框", "簽名本與簽名筆", "QR code 桌卡", "喜糖與小物"],
  "招待桌": ["禮金箱", "禮金簿", "計算機", "原子筆", "橡皮筋與迴紋針", "喜餅名單"],
  "大螢幕與音響": ["大螢幕筆電", "筆電充電器", "HDMI 線與轉接頭", "延長線", "遊戲道具"],
  "急救小物": ["OK 繃", "別針與小剪刀", "吸油面紙", "面紙與濕紙巾", "止痛藥與腸胃藥", "針線包"],
};

export default function Packing() {
  const { data, setData, loading, error, reload } = useLoader(() => fetchPacking(), []);
  const [status, setStatus] = useState("open");
  const [owner, setOwner] = useState("");
  const [modal, setModal] = useState(null); // { item } 編輯 / { defaults } 新增
  const [busy, setBusy] = useState(false);

  const items = data || [];
  const packedCount = items.filter((x) => x.packed).length;
  const owners = useMemo(() => Array.from(new Set(items.map((x) => x.owner).filter(Boolean))), [items]);
  const categories = useMemo(() => {
    const extra = Array.from(new Set(items.map((x) => x.category))).filter((c) => !CATEGORIES.includes(c));
    return [...CATEGORIES, ...extra];
  }, [items]);

  const groups = useMemo(() => {
    const list = items.filter((x) =>
      (status === "all" || (status === "done") === !!x.packed)
      && (!owner || (owner === NO_OWNER ? !x.owner : x.owner === owner)));
    const m = new Map();
    list.forEach((x) => { if (!m.has(x.category)) m.set(x.category, []); m.get(x.category).push(x); });
    return Array.from(m.entries()).sort((a, b) => categories.indexOf(a[0]) - categories.indexOf(b[0]));
  }, [items, status, owner, categories]);

  // 勾選要馬上有反應：先改畫面，失敗再重新載入
  const patch = async (x, body) => {
    setData((list) => list.map((y) => (y.id === x.id ? { ...y, ...body } : y)));
    try { await updatePackingItem(x.id, body); } catch (e) { toastErr(e); reload(); }
  };
  const remove = async (x) => {
    if (!(await confirmDelete(x.name))) return;
    try { await deletePackingItem(x.id); reload(); } catch (e) { toastErr(e); }
  };
  const loadPreset = async () => {
    const ok = await confirmAsk({ title: "帶入常用清單？", text: "會加入證件、新娘、新郎、招待桌…常見要帶的東西，已經有的不會重複，帶入後可以自己刪改。", confirmText: "帶入" });
    if (!ok) return;
    setBusy(true);
    try {
      const body = Object.entries(PRESET).flatMap(([category, names]) => names.map((name) => ({ category, name })));
      const r = await importPacking(body);
      setData(r.items);
      toastOk(r.added ? `加入了 ${r.added} 樣` : "常用的都已經在清單裡了");
    } catch (e) {
      toastErr(e);
    } finally {
      setBusy(false);
    }
  };
  const resetAll = async () => {
    const ok = await confirmAsk({ title: "全部改回「還沒備妥」？", text: "清單內容不會動，只是把勾勾全部拿掉，方便重新收一次。", confirmText: "全部重來" });
    if (!ok) return;
    try { setData(await bulkPacking(false)); } catch (e) { toastErr(e); }
  };

  const close = () => setModal(null);
  const saved = () => { close(); reload(); };
  const pct = items.length ? Math.round((packedCount / items.length) * 100) : 0;

  return (
    <div>
      <PageHead title="當天要帶的東西" sub="婚禮當天要帶去會場的東西列在這裡，寫好誰負責帶；前一晚收進包包就勾起來，出門前再對一次"
        actions={<>
          <button className="btn btn-ghost" onClick={loadPreset} disabled={busy}><ListPlus size={15} /> 帶入常用清單</button>
          <button className="btn btn-primary" onClick={() => setModal({ defaults: { category: CATEGORIES.includes(groups[0]?.[0]) ? groups[0][0] : "其他", owner: owner && owner !== NO_OWNER ? owner : "" } })}><Plus size={15} /> 新增</button>
        </>} />

      <div className="panel">
        {items.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div className="packing-progress">
              <span>已備妥 <b>{packedCount}</b> / {items.length} 樣{packedCount === items.length ? "，全部收好了！" : ""}</span>
              {packedCount > 0 && <button className="btn btn-ghost btn-sm" onClick={resetAll}><RotateCcw size={13} /> 全部重來</button>}
            </div>
            <div className="bar-track"><div className="bar-fill" style={{ width: `${pct}%` }} /></div>
          </div>
        )}

        <div className="toolbar" style={{ marginBottom: 16 }}>
          <Select compact value={status} onChange={setStatus} aria-label="狀態" options={[
            { value: "open", label: `還沒備妥${items.length - packedCount ? `（${items.length - packedCount}）` : ""}` },
            { value: "done", label: "已備妥" },
            { value: "all", label: "全部" },
          ]} />
          <Select compact value={owner} onChange={setOwner} aria-label="誰負責帶" options={[
            { value: "", label: "所有人" },
            ...owners.map((o) => ({ value: o, label: o })),
            { value: NO_OWNER, label: "還沒指定誰帶" },
          ]} />
        </div>

        {loading ? <Loading /> : error ? <ErrorBox error={error} /> : items.length === 0 ? (
          <Empty>清單還是空的。可以按右上「帶入常用清單」先放一份常見的，再自己刪改</Empty>
        ) : groups.length === 0 ? (
          <Empty>{status === "open" ? "這裡的東西都收好了" : "沒有符合的項目"}</Empty>
        ) : groups.map(([name, list]) => (
          <div key={name} className="pl-month">
            <div className="pl-month-title">{name}<span className="muted-cell" style={{ marginLeft: 8, fontWeight: 400, fontSize: 12 }}>{list.filter((x) => x.packed).length} / {list.length} 已備妥</span></div>
            <div className="memo-list packing-list">
              {list.map((x) => (
                <div key={x.id} className={`memo-row${x.packed ? " done" : ""}`}>
                  <Checkbox checked={x.packed} onChange={() => patch(x, { packed: !x.packed })} />
                  <div className="memo-body">
                    <div className={`memo-q${x.packed ? " packing-done" : ""}`}>{x.name}{x.qty > 1 && <span className="packing-qty">× {x.qty}</span>}</div>
                    {x.note && <div className="memo-a">{x.note}</div>}
                    {x.owner && <div className="memo-link"><span className="pill pill-groom">{x.owner} 帶</span></div>}
                  </div>
                  <div className="row-actions">
                    <button className="btn btn-ghost btn-sm" title="編輯" onClick={() => setModal({ item: x })}><Pencil size={13} /></button>{" "}
                    <button className="btn btn-ghost btn-sm" title="刪除" onClick={() => remove(x)}><Trash2 size={13} /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {modal && <PackingModal initial={modal.item} defaults={modal.defaults} categories={categories} owners={owners} onClose={close} onSaved={saved} />}
    </div>
  );
}

function PackingModal({ initial, defaults, categories, owners, onClose, onSaved }) {
  const isNew = !initial?.id;
  const [f, setF] = useState({ category: "其他", name: "", qty: 1, owner: "", note: "", packed: false, ...(defaults || {}), ...(initial || {}) });
  const [customCat, setCustomCat] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const options = [...categories.map((c) => ({ value: c, label: c })), { value: CUSTOM, label: "＋ 自訂分類…" }];

  const save = async () => {
    const category = (f.category === CUSTOM ? customCat : f.category).trim();
    if (!category) return toastErr(new Error("請選分類"));
    if (!f.name.trim()) return toastErr(new Error("請填要帶什麼"));
    setBusy(true);
    try {
      const body = { category, name: f.name.trim(), qty: Math.max(1, parseInt(f.qty, 10) || 1), owner: (f.owner || "").trim(), note: (f.note || "").trim(), packed: !!f.packed };
      if (isNew) await createPackingItem(body); else await updatePackingItem(initial.id, body);
      onSaved();
    } catch (e) {
      toastErr(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={isNew ? "新增要帶的東西" : "編輯"} onClose={onClose}
      footer={<>
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>取消</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>{busy ? "儲存中…" : "儲存"}</button>
      </>}>
      <div className="form-group grid-2">
        <Field label="要帶什麼" required><input type="text" value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="例如：結婚書約" autoFocus /></Field>
        <Field label="數量"><NumberInput value={f.qty} onChange={(v) => set("qty", v)} placeholder="1" /></Field>
      </div>
      <div className="form-group grid-2">
        <Field label="分類" required><Select value={f.category} onChange={(v) => set("category", v)} options={options} aria-label="分類" /></Field>
        {f.category === CUSTOM && <Field label="自訂分類"><input type="text" value={customCat} onChange={(e) => setCustomCat(e.target.value)} placeholder="例如：送客" autoFocus /></Field>}
      </div>
      <Field label="誰負責帶" hint="可留空；伴娘、媽媽、新郎…">
        <input type="text" value={f.owner || ""} onChange={(e) => set("owner", e.target.value)} placeholder="例如：伴娘" />
        {owners.length > 0 && (
          <div className="packing-owner-picks">
            {owners.map((o) => <button type="button" key={o} className={`pill ${f.owner === o ? "pill-yes" : "pill-groom"}`} onClick={() => set("owner", o)}>{o}</button>)}
          </div>
        )}
      </Field>
      <Field label="備註" hint="放在哪裡、要先充電、當天交給誰…"><textarea rows={3} value={f.note || ""} onChange={(e) => set("note", e.target.value)} /></Field>
      <div className="pl-switch-list">
        <Checkbox checked={!!f.packed} onChange={(v) => set("packed", v)}>已備妥</Checkbox>
      </div>
    </Modal>
  );
}
