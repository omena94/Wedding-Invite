// 座位圖的「排位規則」：誰跟誰一定同桌、不要同桌、坐附近、離遠一點；圈子（大學同學、公司同事…）；
// 座位需求（主桌、靠近舞台、靠近入口）；以及檢查結果。
// 判斷都在後端（seat_rules.py），每個排位動作回來的版面都帶著最新的規則狀態與檢查；這裡只負責顯示與編輯。
// 規則的備註常是「前任」這種私事，只有能排座位的人看得到（幫手帶位的唯讀畫面拿不到這些資料）。
import { useMemo, useState } from "react";
import Swal from "sweetalert2";
import { ArrowLeftRight, Ban, CircleCheck, Crown, DoorOpen, Heart, Pencil, Pin, Plus, Star, Trash2, TriangleAlert, Users, X } from "lucide-react";
import { createSeatRule, deleteSeatRule, renameSeatCircle, setGuestPin, setSeatGuests, setTablePins, updateSeatRule } from "../api.js";
import { Checkbox } from "../components/Toggle.jsx";
import Select from "../components/Select.jsx";
import { Field, Modal, confirmDelete, toastErr } from "./ui.jsx";

export const RULE_KINDS = {
  together: { label: "一定同桌", tone: "good", Icon: Heart, hint: "分開回覆的夫妻、情侶，或一定要坐一起的兩家", pick: "選到的幾組會坐同一桌（一桌坐不下時坐隔壁桌）。" },
  near: { label: "坐附近", tone: "good", Icon: Users, hint: "同桌或隔壁桌都好，例如很熟的兩家親戚", pick: "選到的幾組會坐同一桌或隔壁桌。" },
  apart: { label: "不要同桌", tone: "bad", Icon: Ban, hint: "前任、處不來的親戚；隔壁桌還可以", pick: "選到的幾組兩兩都不會坐同一桌。" },
  far: { label: "離遠一點", tone: "bad", Icon: ArrowLeftRight, hint: "連隔壁桌都不要，例如分開的長輩", pick: "選到的幾組兩兩不同桌，也不坐隔壁桌。" },
};
const KIND_ORDER = ["together", "near", "apart", "far"];
export const NEEDS = {
  main: { label: "主桌", Icon: Crown, hint: "雙方家長、媒人、主婚人；一鍵安排會把主桌留給他們" },
  front: { label: "靠近舞台", Icon: Star, hint: "重要長輩、要上台致詞的人" },
  door: { label: "靠近入口", Icon: DoorOpen, hint: "行動不便、輪椅、帶小嬰兒、要早走的人" },
};
const STATUS = { ok: "做到了", broken: "沒做到", pending: "還有人沒排", idle: "不到兩組出席" };
const sideName = (s) => ({ groom: "男方", bride: "女方", other: "共同" })[s] || s;

// 可以指定的桌子（圓桌、長桌），照桌名排：主桌最前面、2 在 10 前面
const tablesOf = (layout) => (layout.objects || [])
  .filter((o) => (o.kind === "round" || o.kind === "rect") && o.seats > 0)
  .sort((a, b) => ((b.label || "").includes("主桌") - (a.label || "").includes("主桌")) || (a.label || "").localeCompare(b.label || "", "zh-Hant", { numeric: true }));
const tableLabel = (o) => o?.label || "沒有名字的桌子";
// 指定到這桌的賓客組（照名單順序）
const pinnedTo = (layout, tableId) => (layout.guests || []).filter((g) => layout.pins?.[g.rsvp_id] === tableId);

// 存檔：成功就把後端回傳的版面交出去（裡面有最新的檢查），失敗跳錯誤
function useSaver(onLayout) {
  const [busy, setBusy] = useState(false);
  const run = async (fn) => {
    setBusy(true);
    try {
      const l = await fn();
      if (l) onLayout(l);
      return true;
    } catch (e) {
      toastErr(e);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return [busy, run];
}

/* ---------- 選賓客（可多選、可搜尋）：規則、圈子、座位需求共用 ---------- */
function GuestChecklist({ guests, value, onChange, names = {} }) {
  const [q, setQ] = useState("");
  const [side, setSide] = useState("");
  const chosen = new Set(value);
  const byId = useMemo(() => new Map(guests.map((g) => [g.rsvp_id, g])), [guests]);
  const sides = useMemo(() => [...new Set(guests.map((g) => g.side))], [guests]);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return guests.filter((g) => (!side || g.side === side) && (!s || g.name.toLowerCase().includes(s) || (g.circle || "").toLowerCase().includes(s)));
  }, [guests, q, side]);
  const toggle = (id) => onChange(chosen.has(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <div className="xp-sr-pick">
      <div className="xp-sr-chosen">
        {value.length
          ? value.map((id) => (
            <button type="button" key={id} className="xp-sr-chip" onClick={() => toggle(id)} title="取消選取">
              {byId.get(id)?.name || names[id] || "（不出席）"} <X size={11} />
            </button>
          ))
          : <span className="muted-cell">還沒選人，從下面勾選</span>}
      </div>
      <div className="xp-sr-pick-bar">
        <input type="text" placeholder="搜尋姓名或圈子…" value={q} onChange={(e) => setQ(e.target.value)} />
        {sides.length > 1 && (
          <Select compact aria-label="篩選親友方" value={side} onChange={setSide}
            options={[{ value: "", label: "全部親友" }, ...sides.map((s) => ({ value: s, label: `${sideName(s)}親友` }))]} />
        )}
      </div>
      <div className="xp-sr-pick-list">
        {list.map((g) => (
          <Checkbox key={g.rsvp_id} className="xp-sr-pick-row" checked={chosen.has(g.rsvp_id)} onChange={() => toggle(g.rsvp_id)}>
            <span className="xp-sr-pick-name">{g.name}</span>
            <span className="xp-sr-pick-meta">{sideName(g.side)}・{g.persons.length} 位{g.circle ? `・${g.circle}` : ""}</span>
          </Checkbox>
        ))}
        {!list.length && <div className="muted-cell xp-sr-pick-none">沒有符合的賓客</div>}
      </div>
    </div>
  );
}

/* ---------- 新增／修改一條規則 ---------- */
function RuleModal({ rule, preset, layout, hall, onClose, onLayout }) {
  const [kind, setKind] = useState(rule?.kind || preset?.kind || "together");
  const [ids, setIds] = useState(() => (rule ? rule.members.map((m) => m.rsvp_id) : preset?.ids || []));
  const [note, setNote] = useState(rule?.note || "");
  const [busy, run] = useSaver(onLayout);
  const names = Object.fromEntries((rule?.members || []).map((m) => [m.rsvp_id, m.name]));
  const save = async () => {
    const body = { kind, rsvp_ids: ids, note: note.trim() };
    if (await run(() => (rule ? updateSeatRule(rule.id, body, hall) : createSeatRule(body, hall)))) onClose();
  };
  const bad = RULE_KINDS[kind].tone === "bad";
  return (
    <Modal title={rule ? "修改排位規則" : "新增排位規則"} onClose={busy ? undefined : onClose} wide
      footer={<>
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>取消</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy || ids.length < 2}>{busy ? "儲存中…" : ids.length < 2 ? "至少選兩組" : "儲存"}</button>
      </>}>
      <div className="xp-sr-kinds" role="radiogroup" aria-label="規則種類">
        {KIND_ORDER.map((k) => {
          const { label, tone, Icon, hint } = RULE_KINDS[k];
          return (
            <button type="button" key={k} role="radio" aria-checked={kind === k} className={`xp-sr-kind tone-${tone}${kind === k ? " on" : ""}`} onClick={() => setKind(k)}>
              <span className="xp-sr-kind-name"><Icon size={14} /> {label}</span>
              <span className="xp-sr-kind-hint">{hint}</span>
            </button>
          );
        })}
      </div>
      <Field label="哪幾組賓客" hint={RULE_KINDS[kind].pick}>
        <GuestChecklist guests={layout.guests || []} value={ids} onChange={setIds} names={names} />
      </Field>
      <Field label="備註（選填）" hint="只有能排座位的人看得到，幫手帶位的畫面不會出現。">
        <input type="text" maxLength={100} value={note} onChange={(e) => setNote(e.target.value)} placeholder={bad ? "例如：前任、兩家有心結" : "例如：分開回覆的夫妻"} />
      </Field>
    </Modal>
  );
}

/* ---------- 新增／修改圈子 ---------- */
function CircleModal({ circle, layout, hall, onClose, onLayout }) {
  const guests = layout.guests || [];
  const members = useMemo(() => (circle ? guests.filter((g) => g.circle === circle).map((g) => g.rsvp_id) : []), [guests, circle]);
  const [name, setName] = useState(circle || "");
  const [ids, setIds] = useState(members);
  const [busy, run] = useSaver(onLayout);
  // 原本在別的圈子的人，存了會移到這個圈子（一組人只會在一個圈子）
  const moving = guests.filter((g) => ids.includes(g.rsvp_id) && g.circle && g.circle !== circle);
  const save = async () => {
    const n = name.trim();
    if (!n) return toastErr(new Error("請幫這個圈子取個名字，例如：大學同學"));
    if (!ids.length) return toastErr(new Error("至少選一組賓客"));
    const added = ids.filter((id) => !members.includes(id));
    const removed = members.filter((id) => !ids.includes(id));
    const ok = await run(async () => {
      let l = null;
      if (circle && n !== circle) l = await renameSeatCircle(circle, n, hall);
      if (added.length) l = await setSeatGuests({ rsvp_ids: added, circle: n }, hall);
      if (removed.length) l = await setSeatGuests({ rsvp_ids: removed, circle: "" }, hall);
      return l;
    });
    if (ok) onClose();
  };
  return (
    <Modal title={circle ? `圈子：${circle}` : "新增圈子"} onClose={busy ? undefined : onClose} wide
      footer={<>
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>取消</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>{busy ? "儲存中…" : "儲存"}</button>
      </>}>
      <Field label="圈子名稱" hint="改成已經有的名字，就會把兩個圈子合在一起。">
        <input type="text" maxLength={30} value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：大學同學、公司同事、爸爸的朋友" />
      </Field>
      <Field label="這個圈子有誰" hint="同一個圈子會盡量坐同一桌，人多坐不下時坐隔壁桌。">
        <GuestChecklist guests={guests} value={ids} onChange={setIds} />
      </Field>
      {moving.length > 0 && <div className="helper-text xp-sr-warnline">{moving.map((g) => `${g.name}（原本在「${g.circle}」）`).join("、")} 會改到這個圈子。</div>}
    </Modal>
  );
}

/* ---------- 座位需求：主桌、靠近舞台、靠近入口 ---------- */
function NeedModal({ need: initial, layout, hall, onClose, onLayout }) {
  const guests = layout.guests || [];
  const holders = (n) => guests.filter((g) => g.seat_need === n).map((g) => g.rsvp_id);
  const [need, setNeed] = useState(initial);
  const [ids, setIds] = useState(() => holders(initial));
  const [busy, run] = useSaver(onLayout);
  const switchNeed = (n) => { setNeed(n); setIds(holders(n)); };
  const moving = guests.filter((g) => ids.includes(g.rsvp_id) && g.seat_need && g.seat_need !== need);
  const save = async () => {
    const before = holders(need);
    const added = ids.filter((id) => !before.includes(id));
    const removed = before.filter((id) => !ids.includes(id));
    const ok = await run(async () => {
      let l = null;
      if (added.length) l = await setSeatGuests({ rsvp_ids: added, seat_need: need }, hall);
      if (removed.length) l = await setSeatGuests({ rsvp_ids: removed, seat_need: "" }, hall);
      return l;
    });
    if (ok) onClose();
  };
  return (
    <Modal title="座位需求" onClose={busy ? undefined : onClose} wide
      footer={<>
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>取消</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>{busy ? "儲存中…" : "儲存"}</button>
      </>}>
      <div className="xp-sr-seg" role="radiogroup" aria-label="哪一種需求">
        {Object.entries(NEEDS).map(([k, v]) => (
          <button type="button" key={k} role="radio" aria-checked={need === k} className={need === k ? "on" : ""} onClick={() => switchNeed(k)}><v.Icon size={13} /> {v.label}</button>
        ))}
      </div>
      <div className="helper-text" style={{ margin: "6px 0 12px" }}>{NEEDS[need].hint}。「靠近舞台」「靠近入口」看的是平面圖上舞台與入口的位置。</div>
      <Field label={`哪幾組要「${NEEDS[need].label}」`}>
        <GuestChecklist guests={guests} value={ids} onChange={setIds} />
      </Field>
      {moving.length > 0 && <div className="helper-text xp-sr-warnline">{moving.map((g) => `${g.name}（原本是「${NEEDS[g.seat_need]?.label}」）`).join("、")} 會改成「{NEEDS[need].label}」。</div>}
    </Modal>
  );
}

/* ---------- 指定桌次：這桌一定坐哪幾組（tableId 沒給就先選桌） ---------- */
function PinModal({ tableId, layout, hall, onClose, onLayout }) {
  const tables = tablesOf(layout);
  const [tid, setTid] = useState(tableId ?? tables[0]?.id ?? null);
  const [ids, setIds] = useState(() => pinnedTo(layout, tid).map((g) => g.rsvp_id));
  const [busy, run] = useSaver(onLayout);
  const table = tables.find((t) => t.id === tid);
  const guests = layout.guests || [];
  const people = guests.filter((g) => ids.includes(g.rsvp_id)).reduce((n, g) => n + g.persons.length, 0);
  const over = table && people > table.seats;
  // 原本指定到別桌的，存了會改到這桌（一組人在一廳只指定一桌）
  const moving = guests.filter((g) => ids.includes(g.rsvp_id) && layout.pins?.[g.rsvp_id] && layout.pins[g.rsvp_id] !== tid);
  const labelOf = (id) => tableLabel(tables.find((t) => t.id === id));
  const switchTable = (v) => { const t = +v; setTid(t); setIds(pinnedTo(layout, t).map((g) => g.rsvp_id)); };
  const save = async () => {
    if (await run(() => setTablePins(tid, ids))) onClose();
  };
  if (!tables.length) {
    return (
      <Modal title="指定桌次" onClose={onClose} footer={<button type="button" className="btn btn-primary" onClick={onClose}>知道了</button>}>
        <div className="helper-text">這一廳還沒有桌子。先到「編輯場地」擺好桌子，再回來指定。</div>
      </Modal>
    );
  }
  return (
    <Modal title={tableId ? `指定坐「${tableLabel(table)}」的賓客` : "指定桌次"} onClose={busy ? undefined : onClose} wide
      footer={<>
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>取消</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy || !tid || over}>{busy ? "儲存中…" : over ? "坐不下" : "儲存"}</button>
      </>}>
      {!tableId && (
        <Field label="哪一桌">
          <Select value={String(tid ?? "")} onChange={switchTable} aria-label="哪一桌"
            options={tables.map((t) => ({ value: String(t.id), label: `${tableLabel(t)}（${t.seats} 位${pinnedTo(layout, t.id).length ? `・已指定 ${pinnedTo(layout, t.id).length} 組` : ""}）` }))} />
        </Field>
      )}
      <div className={`helper-text xp-sr-capline${over ? " over" : ""}`}>
        一鍵安排會最先把他們放進這桌。這桌 {table?.seats || 0} 位，選了 {people} 位{over ? "，坐不下，請少選幾組或分到別桌" : ""}。
      </div>
      <GuestChecklist guests={guests} value={ids} onChange={setIds} />
      {moving.length > 0 && <div className="helper-text xp-sr-warnline">{moving.map((g) => `${g.name}（原本指定「${labelOf(layout.pins[g.rsvp_id])}」）`).join("、")} 會改指定到這桌。</div>}
    </Modal>
  );
}

/* ---------- 一組賓客的排位設定：圈子、座位需求、跟誰有關係 ---------- */
export function GuestSeatModal({ group, layout, hall, onClose, onLayout }) {
  const [circle, setCircle] = useState(group.circle || "");
  const [need, setNeed] = useState(group.seat_need || "");
  const pinNow = layout.pins?.[group.rsvp_id] ? String(layout.pins[group.rsvp_id]) : "";
  const [pin, setPin] = useState(pinNow);
  const [ruleEdit, setRuleEdit] = useState(null); // { rule } 或 { preset: { kind, ids } }
  const [busy, run] = useSaver(onLayout);
  const circles = layout.circles || [];
  const tables = tablesOf(layout);
  const mine = (layout.rules || []).filter((r) => r.members.some((m) => m.rsvp_id === group.rsvp_id));
  const traitsDirty = circle.trim() !== (group.circle || "") || need !== (group.seat_need || "");
  const dirty = traitsDirty || pin !== pinNow;
  const save = async () => {
    if (!dirty) return onClose();
    const ok = await run(async () => {
      let l = null;
      if (traitsDirty) l = await setSeatGuests({ rsvp_ids: [group.rsvp_id], circle: circle.trim(), seat_need: need }, hall);
      if (pin !== pinNow) l = await setGuestPin(group.rsvp_id, pin ? +pin : null, hall);
      return l;
    });
    if (ok) onClose();
  };
  const removeRule = async (r) => {
    if (!(await confirmDelete(`${RULE_KINDS[r.kind].label}：${r.members.map((m) => m.name).join("、")}`))) return;
    await run(() => deleteSeatRule(r.id, hall));
  };
  return (
    <Modal title={`排位設定 — ${group.name}`} onClose={busy ? undefined : onClose} wide
      footer={<>
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>{dirty ? "取消" : "關閉"}</button>
        {dirty && <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>{busy ? "儲存中…" : "儲存"}</button>}
      </>}>
      {tables.length > 0 && (
        <Field label="指定桌次" hint={pin ? "一鍵安排會最先把這組放進這桌；被搬到別桌時「檢查」會提醒。" : "一定要坐哪一桌就選起來（例如雙方家長坐主桌）；沒指定就照規則和圈子排。"}>
          <Select value={pin} onChange={setPin} aria-label="指定桌次"
            options={[{ value: "", label: "不指定" }, ...tables.map((t) => ({ value: String(t.id), label: `${tableLabel(t)}（${t.seats} 位）` }))]} />
        </Field>
      )}
      <Field label="圈子" hint="同一個圈子的人會盡量坐同一桌；點一下選，或打一個新的。">
        {circles.length > 0 && (
          <div className="xp-sr-chips">
            {circles.map((c) => (
              <button type="button" key={c.name} className={`xp-sr-chip${circle === c.name ? " on" : ""}`} onClick={() => setCircle(circle === c.name ? "" : c.name)}>{c.name}</button>
            ))}
          </div>
        )}
        <input type="text" maxLength={30} value={circle} onChange={(e) => setCircle(e.target.value)} placeholder="例如：大學同學、公司同事（空白 = 不分圈子）" />
      </Field>
      <Field label="座位需求" hint={need ? NEEDS[need].hint : "有特別要坐哪裡再選。"}>
        <div className="xp-sr-seg" role="radiogroup" aria-label="座位需求">
          <button type="button" role="radio" aria-checked={!need} className={!need ? "on" : ""} onClick={() => setNeed("")}>沒有</button>
          {Object.entries(NEEDS).map(([k, v]) => (
            <button type="button" key={k} role="radio" aria-checked={need === k} className={need === k ? "on" : ""} onClick={() => setNeed(k)}><v.Icon size={13} /> {v.label}</button>
          ))}
        </div>
      </Field>
      <div className="form-group">
        <label>跟誰有關係</label>
        {mine.length === 0 && <div className="helper-text" style={{ marginTop: 0 }}>還沒有。例如分開回覆的另一半「一定同桌」、前任「不要同桌」。</div>}
        {mine.map((r) => (
          <RuleRow key={r.id} r={r} skip={group.rsvp_id} onEdit={() => setRuleEdit({ rule: r })} onDelete={() => removeRule(r)} />
        ))}
        <div className="xp-sr-addrow">
          {KIND_ORDER.map((k) => {
            const { label, Icon, tone } = RULE_KINDS[k];
            return <button type="button" key={k} className={`btn btn-ghost btn-sm xp-sr-add tone-${tone}`} onClick={() => setRuleEdit({ preset: { kind: k, ids: [group.rsvp_id] } })}><Icon size={13} /> {label}…</button>;
          })}
        </div>
      </div>
      {ruleEdit && <RuleModal rule={ruleEdit.rule} preset={ruleEdit.preset} layout={layout} hall={hall} onClose={() => setRuleEdit(null)} onLayout={onLayout} />}
    </Modal>
  );
}

/* ---------- 一條規則（清單裡的一列） ---------- */
function RuleRow({ r, skip, onEdit, onDelete }) {
  const { label, tone, Icon } = RULE_KINDS[r.kind] || RULE_KINDS.together;
  const members = skip ? r.members.filter((m) => m.rsvp_id !== skip) : r.members;
  return (
    <div className={`xp-sr-rule tone-${tone}`}>
      <div className="xp-sr-rule-main">
        <span className={`xp-sr-kindpill tone-${tone}`}><Icon size={12} /> {label}</span>
        <span className="xp-sr-rule-names">
          {skip && "跟 "}
          {members.map((m, i) => (
            <span key={m.rsvp_id}>{i > 0 && "、"}<span className={m.attending ? "" : "xp-sr-off"} title={m.attending ? undefined : "這組改成不出席了"}>{m.name}</span></span>
          ))}
        </span>
      </div>
      {r.note && <div className="xp-sr-note">{r.note}</div>}
      <div className="xp-sr-rule-foot">
        <span className={`xp-sr-status s-${r.status}`}>{r.status === "ok" ? <CircleCheck size={12} /> : r.status === "broken" ? <TriangleAlert size={12} /> : null}{STATUS[r.status] || ""}</span>
        <span className="xp-sr-rule-acts">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onEdit} title="修改"><Pencil size={12} /></button>
          <button type="button" className="btn btn-ghost btn-sm se-danger" onClick={onDelete} title="刪除這條規則"><Trash2 size={12} /></button>
        </span>
      </div>
    </div>
  );
}

/* ---------- 右側分頁：排位規則 ---------- */
export function RulesPanel({ layout, hall, onLayout }) {
  const [modal, setModal] = useState(null); // { type: "rule" | "circle" | "need", ... }
  const [, run] = useSaver(onLayout);
  const rules = layout.rules || [];
  const circles = layout.circles || [];
  const guests = layout.guests || [];
  const noCircle = guests.filter((g) => !g.circle).length;
  const pinTables = tablesOf(layout).map((t) => ({ t, groups: pinnedTo(layout, t.id) })).filter((x) => x.groups.length);
  const removeRule = async (r) => {
    if (!(await confirmDelete(`${RULE_KINDS[r.kind].label}：${r.members.map((m) => m.name).join("、")}`))) return;
    await run(() => deleteSeatRule(r.id, hall));
  };
  const dissolve = async (c) => {
    const r = await Swal.fire({
      icon: "question", title: `解散「${c.name}」？`, text: `這 ${c.groups} 組會改回沒有圈子；人不會被刪掉，座位也不會動。`,
      showCancelButton: true, confirmButtonText: "解散", cancelButtonText: "取消", confirmButtonColor: "#9E5A54",
    });
    if (r.isConfirmed) await run(() => renameSeatCircle(c.name, "", hall));
  };
  return (
    <div className="xp-sr">
      <p className="helper-text xp-sr-intro">把「誰坐哪一桌、誰跟誰要坐一起、誰跟誰不能坐一起」寫下來：一鍵安排會照著排；你們自己排的時候，沒做到的會在「檢查」提醒。</p>

      <section className="xp-sr-sec">
        <div className="xp-sr-sec-head">
          <span className="pl-list-title">指定桌次</span>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setModal({ type: "pin" })}><Pin size={13} /> 指定桌次</button>
        </div>
        {pinTables.length === 0 && <div className="xp-sr-empty">例如：雙方家長坐主桌、公司同事坐 A3。也可以在平面圖點一張桌子，從座位表上方指定。</div>}
        {pinTables.map(({ t, groups }) => (
          <div className="xp-sr-row" key={t.id}>
            <button type="button" className="xp-sr-row-main" onClick={() => setModal({ type: "pin", tableId: t.id })} title="修改這桌指定給誰">
              <Pin size={13} /> <strong>{tableLabel(t)}</strong>
              <span className="muted-cell xp-sr-row-sub">{groups.map((g) => g.name).join("、")}</span>
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setModal({ type: "pin", tableId: t.id })}>修改</button>
          </div>
        ))}
      </section>

      <section className="xp-sr-sec">
        <div className="xp-sr-sec-head">
          <span className="pl-list-title">誰跟誰</span>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setModal({ type: "rule" })}><Plus size={13} /> 新增規則</button>
        </div>
        {rules.length === 0 && <div className="xp-sr-empty">例如：分開回覆的夫妻「一定同桌」、前任「不要同桌」、兩家很熟的親戚「坐附近」、分開的長輩「離遠一點」。</div>}
        {KIND_ORDER.flatMap((k) => rules.filter((r) => r.kind === k)).map((r) => (
          <RuleRow key={r.id} r={r} onEdit={() => setModal({ type: "rule", rule: r })} onDelete={() => removeRule(r)} />
        ))}
      </section>

      <section className="xp-sr-sec">
        <div className="xp-sr-sec-head">
          <span className="pl-list-title">圈子</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setModal({ type: "circle" })}><Plus size={13} /> 新增圈子</button>
        </div>
        <div className="helper-text xp-sr-sec-hint">同一個圈子盡量坐同一桌、坐不下就坐隔壁桌；「檢查」會找出同桌一個認識的人都沒有的人。</div>
        {circles.map((c) => (
          <div className="xp-sr-row" key={c.name}>
            <button type="button" className="xp-sr-row-main" onClick={() => setModal({ type: "circle", circle: c.name })} title="修改名稱或成員">
              <strong>{c.name}</strong> <span className="muted-cell">{c.groups} 組・{c.people} 位</span>
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => dissolve(c)}>解散</button>
          </div>
        ))}
        {circles.length > 0 && noCircle > 0 && <div className="helper-text">還有 {noCircle} 組沒有分圈子。</div>}
      </section>

      <section className="xp-sr-sec">
        <div className="xp-sr-sec-head"><span className="pl-list-title">座位需求</span></div>
        {Object.entries(NEEDS).map(([k, v]) => {
          const who = guests.filter((g) => g.seat_need === k);
          return (
            <div className="xp-sr-row" key={k}>
              <button type="button" className="xp-sr-row-main" onClick={() => setModal({ type: "need", need: k })}>
                <v.Icon size={13} /> <strong>{v.label}</strong>
                <span className="muted-cell xp-sr-row-sub">{who.length ? who.map((g) => g.name).join("、") : v.hint}</span>
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setModal({ type: "need", need: k })}>{who.length ? "修改" : "設定"}</button>
            </div>
          );
        })}
      </section>

      {modal?.type === "rule" && <RuleModal rule={modal.rule} layout={layout} hall={hall} onClose={() => setModal(null)} onLayout={onLayout} />}
      {modal?.type === "circle" && <CircleModal circle={modal.circle} layout={layout} hall={hall} onClose={() => setModal(null)} onLayout={onLayout} />}
      {modal?.type === "pin" && <PinModal tableId={modal.tableId} layout={layout} hall={hall} onClose={() => setModal(null)} onLayout={onLayout} />}
      {modal?.type === "need" && <NeedModal need={modal.need} layout={layout} hall={hall} onClose={() => setModal(null)} onLayout={onLayout} />}
    </div>
  );
}

/* ---------- 右側分頁：檢查 ---------- */
export function IssuesPanel({ issues, onFocus }) {
  const no = issues.filter((i) => i.level === "no");
  const warn = issues.filter((i) => i.level !== "no");
  if (!issues.length) {
    return (
      <div className="xp-sr-allgood">
        <CircleCheck size={28} />
        <div className="pl-list-title">目前沒有發現問題</div>
        <div className="helper-text">規則都做到了，也沒有人落單。排的時候會隨時重新檢查。</div>
      </div>
    );
  }
  const row = (i) => (
    <button type="button" key={i.key} className={`xp-sr-issue ${i.level}`} onClick={() => onFocus(i)} title={i.object_ids.length ? "在平面圖上標出來" : undefined}>
      <TriangleAlert size={14} /><span>{i.text}</span>
    </button>
  );
  return (
    <div className="xp-sr">
      {no.length > 0 && (
        <>
          <div className="xp-sr-ihead no">規則沒做到 {no.length}</div>
          {no.map(row)}
        </>
      )}
      {warn.length > 0 && (
        <>
          <div className="xp-sr-ihead warn">建議調整 {warn.length}</div>
          <div className="helper-text xp-sr-sec-hint">不一定要改，看你們的判斷；點一下會在平面圖上標出來。</div>
          {warn.map(row)}
        </>
      )}
    </div>
  );
}

/* ---------- 賓客卡片上的小標籤：圈子、座位需求、有幾條規則 ---------- */
export function GuestTags({ g, ruleCount, pinLabel }) {
  const need = NEEDS[g.seat_need];
  if (!g.circle && !need && !ruleCount && !pinLabel) return null;
  return (
    <div className="xp-sr-tags">
      {pinLabel && <span className="xp-sr-tag pin" title="指定桌次"><Pin size={11} />指定 {pinLabel}</span>}
      {g.circle && <span className="xp-sr-tag" title="圈子">{g.circle}</span>}
      {need && <span className="xp-sr-tag need" title={need.hint}><need.Icon size={11} />{need.label}</span>}
      {ruleCount > 0 && <span className="xp-sr-tag rule" title="跟別組有排位規則">規則 {ruleCount}</span>}
    </div>
  );
}

/* ---------- 座位表上方：排定這桌、這桌坐了哪些圈子、這桌的問題 ---------- */
export function TableRuleBar({ o, issues, guestOf, onKeep, onFocusIssue, layout, hall, onLayout }) {
  const [pinOpen, setPinOpen] = useState(false);
  const pinned = layout ? pinnedTo(layout, o.id) : [];
  // 依人數算每個圈子（一眼看出這桌是不是都認識）；整場都沒分圈子就不顯示
  const mix = {};
  (o.assignments || []).forEach((a) => {
    const c = guestOf?.get(a.rsvp_id)?.circle || "沒分圈子";
    mix[c] = (mix[c] || 0) + 1;
  });
  const parts = Object.entries(mix).sort((a, b) => b[1] - a[1]);
  const showMix = parts.some(([c]) => c !== "沒分圈子");
  return (
    <div className="xp-sr-tp">
      <Checkbox checked={!!o.meta?.keep_seats} onChange={onKeep}>排定這桌（一鍵安排、清空座位都不會動它）</Checkbox>
      {layout && o.kind !== "chair" && (
        <div className="xp-sr-tp-pin">
          <Pin size={12} />
          {pinned.length ? <span>指定這桌：{pinned.map((g) => g.name).join("、")}</span> : <span className="muted-cell">還沒指定誰一定坐這桌</span>}
          <button type="button" className="pl-linkbtn" onClick={() => setPinOpen(true)}>{pinned.length ? "修改" : "指定…"}</button>
        </div>
      )}
      {pinOpen && <PinModal tableId={o.id} layout={layout} hall={hall} onClose={() => setPinOpen(false)} onLayout={onLayout} />}
      {showMix && <div className="xp-sr-tp-mix">這桌：{parts.map(([c, n]) => `${c} ${n}`).join("・")}</div>}
      {issues.map((i) => (
        <button type="button" key={i.key} className={`xp-sr-issue ${i.level}`} onClick={() => onFocusIssue(i)}><TriangleAlert size={13} /><span>{i.text}</span></button>
      ))}
    </div>
  );
}

/* ---------- 選了一張桌子時：這組放這桌合不合適 ---------- */
export function FitHints({ hints }) {
  if (!hints.length) return null;
  return (
    <div className="xp-sr-fits">
      {hints.map((h, i) => (
        <span key={i} className={`xp-sr-fit ${h.tone}`}>{h.tone === "bad" ? <TriangleAlert size={11} /> : <CircleCheck size={11} />}{h.text}</span>
      ))}
    </div>
  );
}
