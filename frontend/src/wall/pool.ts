// 留言池：螢幕上可以出現的留言，以及「誰最近上過螢幕」。
// 導演（每個窗格挑一則主打）和即時小卡（新留言馬上跳、舊留言隨機再冒）都從這裡拿，
// 規則：新留言優先；其他的挑「最久沒出現」的那群裡隨機一則，同一則不要短時間內一直出現。
import type { Msg } from './engine/scene';
import { cleanMessage, cleanName } from './engine/text';
import { loadText } from './engine/type';

export interface RawMessage { id: number; name: string; text: string; created_at?: string; source?: string }

export class MessagePool {
  /** 已經準備好（字型載好）可以上螢幕的留言，依 id 排序。 */
  private list: Msg[] = [];
  private byId = new Map<number, Msg>();
  /** 每則最後一次上螢幕的時間（performance.now 毫秒；主打與小卡都算）。 */
  private lastShown = new Map<number, number>();
  /** 還沒當過主打的新留言（先進先出）。 */
  private fresh: number[] = [];
  /** 還在準備字型的 id（避免重複準備）。 */
  private pending = new Set<number>();
  /** 新留言準備好時通知（main.ts 用來排即時小卡）。 */
  onArrive: (m: Msg) => void = () => {};
  /** 留言被隱藏／刪除時通知。 */
  onRemove: (id: number) => void = () => {};

  get count() { return this.list.length; }
  /** 還在排隊等當主打的新留言有幾則。 */
  get freshCount() { return this.fresh.length; }
  get all(): readonly Msg[] { return this.list; }
  get(id: number) { return this.byId.get(id); }

  /**
   * 跟伺服器的最新清單同步：新的準備好字型再加進來（第一次同步的舊留言不算「新」，不會一次跳一堆小卡），
   * 不見了的（被隱藏或刪除）拿掉並通知。
   */
  async sync(rows: RawMessage[], initial = false) {
    const ids = new Set(rows.map((r) => r.id));
    for (const m of [...this.list]) if (!ids.has(m.id)) this.removeLocal(m.id);
    // 內容被新人改過的，也更新
    for (const r of rows) {
      const m = this.byId.get(r.id);
      if (m && (m.text !== cleanMessage(r.text) || m.name !== cleanName(r.name))) { m.text = cleanMessage(r.text); m.name = cleanName(r.name); }
    }
    const incoming = rows.filter((r) => !this.byId.has(r.id) && !this.pending.has(r.id));
    if (!incoming.length) return;
    incoming.forEach((r) => this.pending.add(r.id));
    const msgs = incoming.map((r) => ({ id: r.id, name: cleanName(r.name), text: cleanMessage(r.text), n: 0, couple: r.source === 'couple' }));
    // 字型分片先下載好，第一次畫出來才不會是系統字
    await loadText(msgs.map((m) => m.text + m.name).join(''));
    for (const m of msgs) {
      this.pending.delete(m.id);
      if (!ids.has(m.id)) continue;
      this.byId.set(m.id, m);
      this.list.push(m);
      if (!initial) this.fresh.push(m.id);
    }
    this.list.sort((a, b) => a.id - b.id);
    this.list.forEach((m, i) => (m.n = i + 1));
    if (!initial) for (const m of msgs) if (this.byId.has(m.id)) this.onArrive(m);
  }

  private removeLocal(id: number) {
    this.byId.delete(id);
    this.list = this.list.filter((m) => m.id !== id);
    this.fresh = this.fresh.filter((x) => x !== id);
    this.list.forEach((m, i) => (m.n = i + 1));
    this.onRemove(id);
  }

  markShown(id: number) { this.lastShown.set(id, performance.now()); }

  /** 距離上次出現幾秒（沒出現過是無限大）。 */
  sinceShown(id: number) { const t = this.lastShown.get(id); return t === undefined ? Infinity : (performance.now() - t) / 1000; }

  /**
   * 下一則主打留言：新留言優先；否則在最久沒出現的三成裡隨機挑。`exclude` 是現在正在畫面上的（小卡、上一個窗格）。
   * `rnd` 是 0..1 的亂數（導演用種子給，才可重現）。沒有留言回傳 null。
   */
  nextHero(rnd: number, exclude: Set<number> = new Set()): Msg | null {
    while (this.fresh.length) {
      const id = this.fresh.shift()!;
      const m = this.byId.get(id);
      if (m && !exclude.has(id)) return m;
    }
    return this.pickOld(rnd, exclude, 0);
  }

  /** 隨機再冒出來的小卡：至少 minGap 秒沒出現過的舊留言。 */
  nextPopup(rnd: number, exclude: Set<number> = new Set(), minGap = 120): Msg | null {
    return this.pickOld(rnd, exclude, minGap);
  }

  private pickOld(rnd: number, exclude: Set<number>, minGap: number): Msg | null {
    const cands = this.list.filter((m) => !exclude.has(m.id) && this.sinceShown(m.id) >= minGap);
    if (!cands.length) return null;
    cands.sort((a, b) => this.sinceShown(b.id) - this.sinceShown(a.id));
    const top = cands.slice(0, Math.max(1, Math.ceil(cands.length * 0.3)));
    return top[Math.floor(rnd * top.length)] ?? null;
  }
}
