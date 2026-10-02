// 排位規則的即時提示：在平面圖點一張桌子時，每組賓客「放這桌合不合適」。
// 整份的檢查（哪條規則沒做到、誰落單）在後端 seat_rules.py，每個排位動作回來的版面都帶著；
// 這裡只算選到的這一桌，判斷標準跟後端一樣：坐附近 = 同桌或隔壁桌，隔壁桌由後端依平面圖位置算好放在 layout.geo.adj。

/** 從版面整理出查詢用的索引（版面變了才重算一次）。 */
export function ruleIndex(layout) {
  const guests = new Map((layout?.guests || []).map((g) => [g.rsvp_id, g]));
  const rulesOf = new Map();
  for (const r of layout?.rules || []) {
    for (const m of r.members) {
      if (!rulesOf.has(m.rsvp_id)) rulesOf.set(m.rsvp_id, []);
      rulesOf.get(m.rsvp_id).push(r);
    }
  }
  const tablesOf = new Map();
  for (const o of layout?.objects || []) {
    for (const a of o.assignments || []) {
      if (!tablesOf.has(a.rsvp_id)) tablesOf.set(a.rsvp_id, new Set());
      tablesOf.get(a.rsvp_id).add(o.id);
    }
  }
  // 指定桌次：rsvp id → 桌 id（這一廳），桌名用來寫「指定坐「A3」」
  const pins = new Map(Object.entries(layout?.pins || {}).map(([rid, oid]) => [+rid, oid]));
  const labels = new Map((layout?.objects || []).map((o) => [o.id, o.label || "沒有名字的桌子"]));
  const pinLabel = (rid) => (pins.has(rid) ? labels.get(pins.get(rid)) || "" : "");
  return { guests, rulesOf, tablesOf, adj: layout?.geo?.adj || {}, main: new Set(layout?.geo?.main || []), pins, labels, pinLabel };
}

const names = (idx, ids) => ids.map((i) => idx.guests.get(i)?.name).filter(Boolean).join("、");

/** 這組人放進這張桌子合不合適：[{tone: "good" | "bad", text}]，不合適的排前面。 */
export function fitHints(g, table, idx) {
  if (!g || !table || !idx) return [];
  const here = new Set((table.assignments || []).map((a) => a.rsvp_id));
  here.delete(g.rsvp_id);
  const around = new Set([table.id, ...(idx.adj[String(table.id)] || [])]);
  const isHere = (rid) => here.has(rid);
  const isNear = (rid) => [...(idx.tablesOf.get(rid) || [])].some((t) => around.has(t));
  const bad = [];
  const good = [];
  // 指定桌次是新人親手定的，放最前面
  if (idx.pins?.has(g.rsvp_id)) {
    if (idx.pins.get(g.rsvp_id) === table.id) good.push("指定坐這桌");
    else bad.push(`指定坐「${idx.pinLabel(g.rsvp_id)}」`);
  }
  for (const r of idx.rulesOf.get(g.rsvp_id) || []) {
    const others = r.members.map((m) => m.rsvp_id).filter((id) => id !== g.rsvp_id);
    if (r.kind === "apart") {
      const x = others.filter(isHere);
      if (x.length) bad.push(`跟 ${names(idx, x)} 不要同桌`);
    } else if (r.kind === "far") {
      const x = others.filter(isNear);
      if (x.length) bad.push(`要離 ${names(idx, x)} 遠一點`);
    } else if (r.kind === "together") {
      const x = others.filter(isHere);
      const elsewhere = others.filter((id) => !isHere(id) && idx.tablesOf.has(id));
      if (x.length) good.push(`跟 ${names(idx, x)} 一定同桌`);
      else if (elsewhere.length) bad.push(`${names(idx, elsewhere)} 坐別桌（設了一定同桌）`);
    } else if (r.kind === "near") {
      const x = others.filter(isNear);
      if (x.length) good.push(`${names(idx, x)} 在附近`);
    }
  }
  if (g.circle) {
    const n = [...here].filter((rid) => idx.guests.get(rid)?.circle === g.circle).length;
    if (n) good.push(`同圈子 ${n} 組在這桌`);
  }
  if (g.seat_need === "main" && idx.main.has(table.id)) good.push("這是主桌");
  return [...bad.map((text) => ({ tone: "bad", text })), ...good.map((text) => ({ tone: "good", text }))];
}
