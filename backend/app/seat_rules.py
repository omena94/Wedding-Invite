"""排位規則：圈子、座位需求、幾組人之間的「一定同桌／不要同桌／坐附近／離遠一點」，以及照這些條件檢查與一鍵安排。

排座位真正花時間的不是把人放上椅子，而是記住「誰跟誰不能坐一起、誰一定要在一起、這桌有沒有人落單」。
這些條件寫下來之後：手動排的當下就提醒哪裡沒做到；一鍵安排照著排；排完再整份檢查一次。

檢查與一鍵安排放在同一個檔案、用同一套「桌子遠近」：分開寫很容易兩邊判斷不一致（安排說做到了、檢查卻說沒做到）。
桌子遠近看平面圖的位置，不靠桌號（桌號常常不照位置編）：
- 隔壁桌：每張桌到最近一張桌的距離取中位數當「一個桌距」，1.5 個桌距內算隔壁（斜對角也算）。
- 靠近舞台：依離舞台的距離排名；沒有放舞台就照桌名（主桌、1、2、3…）。
- 靠近入口：依離入口的距離排名；沒有放入口就當作離舞台最遠的那幾桌。
"""
from __future__ import annotations

import json
import math
import time
from collections import defaultdict
from itertools import combinations

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Rsvp, SeatAssignment, SeatHall, SeatObject, SeatRule
from .seating import load_objects, persons_for, seat_count, table_sort_key

RULE_LABEL = {"together": "一定同桌", "apart": "不要同桌", "near": "坐附近", "far": "離遠一點"}
NEED_LABEL = {"main": "主桌", "front": "靠近舞台", "door": "靠近入口"}
NEED_RANK = {"main": 3, "door": 2, "front": 1, "": 0}  # 一份裡好幾組需求不同時，照這個順序取最要緊的
OPPOSITE_SIDE = {"groom": "bride", "bride": "groom"}
# 互相矛盾的規則：同兩組不能同時設
CONFLICTS = {frozenset(("together", "apart")), frozenset(("together", "far")), frozenset(("near", "far"))}
FRONT_SHARE = 0.34  # 名次在前三分之一，算「靠近舞台／入口」

# 一鍵安排的分數：正的是想要、負的是不想要，只有相對大小有意義。
W_APART = -1000         # 不要同桌：幾乎等於禁止（真的沒有別的位子才會違反，違反了檢查會列出來）
W_FAR_SAME = -400
W_FAR_ADJ = -150
W_TOGETHER_SAME = 300   # 一定同桌的人已經坐在某桌（例如先手排好的）：跟過去
W_TOGETHER_ADJ = 200    # 一桌坐不下時，至少坐隔壁
# 新人親手設的規則與需求，要比「同圈子坐一起」這種推測來得重要
W_NEAR_SAME = 280
W_NEAR_ADJ = 260
W_CIRCLE_SAME = 20      # 每一對同圈子同桌
W_ALONE = -80           # 一組人坐的那桌沒有同圈子的人（落單）：比「朋友少幾個」嚴重得多，所以另外扣
W_CIRCLE_ADJ = 4        # 每一對同圈子坐隔壁桌：一個圈子坐兩三桌時，桌子連在一起
W_CIRCLE_MIX = -6       # 每一對不同圈子同桌（兩邊都有圈子才算）：有空桌就不硬湊
W_SIDE_MIX = -15        # 每一對男女方同桌（選了男女方分開時）
W_MAIN_YES = 200
W_MAIN_RESERVED = -400  # 主桌留給標了「主桌」的人（雙方家長、媒人），其他人沒位子了才放
W_MAIN_ELSEWHERE = -100
W_NEED_ZONE = 200       # 靠近舞台／入口：落在前三分之一（跟檢查的標準一樣）
W_NEED_GRADE = 30       # 同樣在範圍內，越近越好
W_CHAIR = -20           # 單張椅子（臨時加的）留到最後才用
W_ORDER = 4             # 沒有其他考量時：男方從第一桌往後、女方從最後一桌往前
# 只在第一輪（一份一份放）用：已經有人的桌子優先、剛好坐滿再加分。喜宴依桌計價，少開一桌是一桌
W_FILL = 6
W_EXACT = 8
W_ROOM = 10             # 圈子的第一組先挑坐得下整個圈子的桌，不要坐進只剩幾個空位的桌把同學拆散
SEARCH_SECONDS = 1.5    # 第二輪（搬動、對調）最多花多久；賓客一兩百組通常一秒內就收斂


# ---------------- 桌子的遠近 ----------------
def _center(o: SeatObject) -> tuple[float, float]:
    # 跟前端 geometry.center 一樣：圓桌與柱子的 w 是直徑
    h = o.w if o.kind in ("round", "column") else o.h
    return (o.x + o.w / 2, o.y + h / 2)


def _rect_dist(p: tuple[float, float], o: SeatObject) -> float:
    """點到物件外框的距離（不算旋轉；舞台、入口很少轉角度，分前後這樣就夠）。"""
    dx = max(o.x - p[0], 0, p[0] - (o.x + o.w))
    dy = max(o.y - p[1], 0, p[1] - (o.y + o.h))
    return math.hypot(dx, dy)


def table_name(o: SeatObject) -> str:
    if o.label:
        return f"「{o.label}」"
    return "單張椅子" if o.kind == "chair" else "沒有名字的桌子"


class Geo:
    """這一廳桌子之間的遠近：哪些是隔壁桌、哪些靠舞台、哪些靠入口、哪幾張是主桌。"""

    def __init__(self, objects: list[SeatObject]):
        self.tables = [o for o in objects if seat_count(o) > 0]
        self.by_id = {o.id: o for o in self.tables}
        pos = {o.id: _center(o) for o in self.tables}
        ids = [o.id for o in self.tables]
        # 一個桌距只用圓桌、長桌算：單張椅子常排成一排，彼此很近，會把桌距拉得太小
        base = [o.id for o in self.tables if o.kind in ("round", "rect")]
        if len(base) < 2:
            base = ids
        nearest = sorted(d for d in (min((math.dist(pos[a], pos[b]) for b in base if b != a), default=0) for a in base) if d > 0)
        pitch = nearest[len(nearest) // 2] if nearest else 0
        self.adj: dict[int, set[int]] = {i: set() for i in ids}
        if pitch > 0:
            for a, b in combinations(ids, 2):
                if math.dist(pos[a], pos[b]) <= pitch * 1.5:
                    self.adj[a].add(b)
                    self.adj[b].add(a)
        self.main = {o.id for o in self.tables if "主桌" in (o.label or "")}
        by_label = sorted(self.tables, key=lambda o: (table_sort_key(o.label), o.y, o.x))
        self.order = self._ranks(by_label)
        stages = [o for o in objects if o.kind == "stage"]
        doors = [o for o in objects if o.kind == "entrance"]
        front = by_label
        if stages:
            front = sorted(self.tables, key=lambda o: (o.id not in self.main, min(_rect_dist(pos[o.id], s) for s in stages), self.order[o.id]))
        self.front = self._ranks(front)
        self.has_door = bool(doors)
        door = list(reversed(front))
        if doors:
            door = sorted(self.tables, key=lambda o: (min(_rect_dist(pos[o.id], d) for d in doors), self.order[o.id]))
        self.door = self._ranks(door)

    @staticmethod
    def _ranks(seq: list[SeatObject]) -> dict[int, float]:
        """名次換成 0（最前）～ 1（最後）。"""
        n = len(seq)
        return {o.id: (i / (n - 1) if n > 1 else 0.0) for i, o in enumerate(seq)}

    def near(self, a: int, b: int) -> bool:
        return a == b or b in self.adj.get(a, ())

    def out(self) -> dict:
        """給前端：點一張桌子時，賓客卡片要知道誰在隔壁桌。"""
        return {"adj": {str(k): sorted(v) for k, v in self.adj.items()}, "main": sorted(self.main)}


# ---------------- 規則的讀寫 ----------------
def load_rules(db: Session) -> list[SeatRule]:
    """所有規則；成員被刪到剩不到兩組的規則一起清掉（只剩一組的規則沒有意義）。"""
    rules = db.scalars(select(SeatRule).order_by(SeatRule.id.asc())).all()
    ids = {i for r in rules for i in r.rsvp_ids}
    if not ids:
        return list(rules)
    exist = set(db.scalars(select(Rsvp.id).where(Rsvp.id.in_(ids))).all())
    keep, dirty = [], False
    for r in rules:
        members = [i for i in r.rsvp_ids if i in exist]
        if len(members) < 2:
            db.delete(r)
            dirty = True
            continue
        if members != r.rsvp_ids:
            r.rsvp_ids_json = json.dumps(members)
            dirty = True
        keep.append(r)
    if dirty:
        db.commit()
    return keep


def clean_members(db: Session, ids: list[int]) -> list[int]:
    """去掉重複、確認每一組都是這場婚禮的賓客（不是測試資料）。不夠兩組就擋下。"""
    ids = list(dict.fromkeys(int(i) for i in ids))
    found = set(db.scalars(select(Rsvp.id).where(Rsvp.id.in_(ids), Rsvp.is_test.is_(False))).all())
    if len(found) < len(ids):
        raise ValueError("有幾位賓客找不到（可能被刪掉了），請重新整理再選一次")
    if len(ids) < 2:
        raise ValueError("規則至少要選兩組賓客")
    return ids


def find_conflict(db: Session, kind: str, ids: list[int], skip_id: int | None = None) -> str | None:
    """新規則跟現有的規則打架嗎？例如 A、B 一定同桌，又設 A、B 不要同桌。
    一定同桌會串起來（A 跟 B、B 跟 C 一定同桌，等於 A 跟 C 也要同桌），所以要整串一起看。"""
    rules = [r for r in load_rules(db) if r.id != skip_id]
    names = {r.id: r.name for r in db.scalars(select(Rsvp).where(Rsvp.id.in_({*ids, *(i for r in rules for i in r.rsvp_ids)}))).all()}
    mine = set(ids)
    for r in rules:
        both = mine & set(r.rsvp_ids)
        if len(both) < 2:
            continue
        if r.kind == kind and set(r.rsvp_ids) == mine:
            return "已經有一樣的規則了"
        if frozenset((r.kind, kind)) in CONFLICTS:
            who = "、".join(names.get(i, "") for i in ids if i in both)
            return f"{who} 已經設了「{RULE_LABEL[r.kind]}」，不能同時「{RULE_LABEL[kind]}」；要改請先刪掉原本那條"
    # 一定同桌串起來之後，跟「不要同桌／離遠一點」有沒有矛盾
    every = rules + [SeatRule(id=-1, kind=kind, rsvp_ids_json=json.dumps(ids))]
    root: dict[int, int] = {}

    def find(x: int) -> int:
        root.setdefault(x, x)
        while root[x] != x:
            root[x] = root[root[x]]
            x = root[x]
        return x

    for r in every:
        if r.kind == "together":
            first, *rest = r.rsvp_ids
            for i in rest:
                root[find(i)] = find(first)
    for r in every:
        if r.kind not in ("apart", "far"):
            continue
        for a, b in combinations(r.rsvp_ids, 2):
            if find(a) == find(b):
                return (f"{names.get(a, '')}、{names.get(b, '')} 透過「一定同桌」串在一起，又設了「{RULE_LABEL[r.kind]}」，"
                        "兩條規則沒辦法同時做到")
    return None


def rule_out(r: SeatRule, by_id: dict[int, Rsvp], status: str) -> dict:
    return {
        "id": r.id,
        "kind": r.kind,
        "label": RULE_LABEL.get(r.kind, r.kind),
        "note": r.note,
        "status": status,  # ok 做到了 / broken 沒做到 / pending 還有人沒排 / idle 不到兩組出席
        "members": [
            {"rsvp_id": i, "name": by_id[i].name, "side": by_id[i].side, "attending": bool(by_id[i].attending and not by_id[i].is_test)}
            for i in r.rsvp_ids if i in by_id
        ],
    }


def circles_out(rsvps: list[Rsvp]) -> list[dict]:
    agg: dict[str, dict] = {}
    for r in rsvps:
        if r.circle:
            c = agg.setdefault(r.circle, {"name": r.circle, "groups": 0, "people": 0})
            c["groups"] += 1
            c["people"] += len(persons_for(r))
    return sorted(agg.values(), key=lambda c: (-c["people"], c["name"]))


# ---------------- 檢查 ----------------
def check(geo: Geo, rsvps: list[Rsvp], rules: list[SeatRule], seated: dict[int, dict[int, int]], complete: bool) -> tuple[list[dict], dict[int, str]]:
    """這一廳現在的安排哪裡沒做到。seated：rsvp id → {桌 id: 坐了幾位}。
    回傳（問題清單, 每條規則的狀態）。問題分兩級：no 規則沒做到（一定要處理）、warn 建議調整（看新人自己判斷）。
    complete = 每個人都有位子了：桌子太空這種事要排完才準，排到一半每桌都還空空的。"""
    by_id = {r.id: r for r in rsvps}
    issues: list[dict] = []
    status: dict[int, str] = {}

    def add(level, kind, text, tables, rids, key):
        issues.append({"key": key, "level": level, "kind": kind, "text": text,
                       "object_ids": [t for t in dict.fromkeys(tables) if t in geo.by_id], "rsvp_ids": list(dict.fromkeys(rids))})

    def tname(tid):
        return table_name(geo.by_id[tid])

    def home(rid):
        """這組人主要坐哪一桌（被拆開時取人最多的那桌）。"""
        at = seated.get(rid) or {}
        return max(at, key=lambda t: (at[t], -geo.order.get(t, 0))) if at else None

    occupants: dict[int, set[int]] = defaultdict(set)
    for rid, at in seated.items():
        for tid in at:
            occupants[tid].add(rid)
    partners: dict[int, set[int]] = defaultdict(set)  # 一定同桌、坐附近的夥伴（同桌有夥伴就不算落單）

    for rule in rules:
        members = [i for i in rule.rsvp_ids if i in by_id]
        placed = [i for i in members if seated.get(i)]
        note = f"（{rule.note}）" if rule.note else ""
        names = lambda ids: "、".join(by_id[i].name for i in ids)  # noqa: E731
        broken = False
        if rule.kind in ("together", "near"):
            for a in members:
                partners[a].update(m for m in members if m != a)
        if rule.kind == "apart":
            for tid in {t for i in placed for t in seated[i]}:
                same = [i for i in placed if tid in seated[i]]
                if len(same) >= 2:
                    broken = True
                    add("no", "apart", f"{names(same)} 設了「不要同桌」{note}，現在都坐在{tname(tid)}", [tid], same, f"apart:{rule.id}:{tid}")
        elif rule.kind == "together":
            homes = {i: home(i) for i in placed}
            if len(set(homes.values())) > 1:
                broken = True
                tids = sorted(set(homes.values()), key=lambda t: geo.order.get(t, 0))
                add("no", "together", f"{names(placed)} 設了「一定同桌」{note}，現在分在{'、'.join(tname(t) for t in tids)}", tids, placed, f"together:{rule.id}")
        elif rule.kind == "near":
            for a, b in combinations(placed, 2):
                ta, tb = home(a), home(b)
                if not geo.near(ta, tb):
                    broken = True
                    add("warn", "near", f"{names([a, b])} 設了「坐附近」{note}，{tname(ta)}和{tname(tb)}離有點遠", [ta, tb], [a, b], f"near:{rule.id}:{a}:{b}")
        elif rule.kind == "far":
            for a, b in combinations(placed, 2):
                ta, tb = home(a), home(b)
                if ta == tb:
                    broken = True
                    add("no", "far", f"{names([a, b])} 設了「離遠一點」{note}，現在坐同一桌（{tname(ta)}）", [ta], [a, b], f"far:{rule.id}:{a}:{b}")
                elif geo.near(ta, tb):
                    broken = True
                    add("warn", "far", f"{names([a, b])} 設了「離遠一點」{note}，現在坐隔壁桌（{tname(ta)}、{tname(tb)}）", [ta, tb], [a, b], f"far:{rule.id}:{a}:{b}")
        if len(members) < 2:
            status[rule.id] = "idle"
        elif broken:
            status[rule.id] = "broken"
        else:
            status[rule.id] = "ok" if len(placed) == len(members) else "pending"

    # 同一組被拆到不同桌（一組比最大的桌子還多人就沒辦法，不提醒）
    biggest = max((seat_count(o) for o in geo.tables), default=0)
    for r in rsvps:
        at = seated.get(r.id) or {}
        if len(at) > 1 and len(persons_for(r)) <= biggest:
            tids = sorted(at, key=lambda t: geo.order.get(t, 0))
            add("warn", "split", f"{r.name} 這組 {sum(at.values())} 位分在{'、'.join(tname(t) for t in tids)}", tids, [r.id], f"split:{r.id}")

    # 落單：同桌沒有同圈子的人、也沒有規則夥伴，而同圈子的其他人坐在別桌
    by_circle: dict[str, list[int]] = defaultdict(list)
    for r in rsvps:
        if r.circle and seated.get(r.id):
            by_circle[r.circle].append(r.id)
    for circle, ids in by_circle.items():
        for rid in ids:
            h = home(rid)
            mates = occupants[h] - {rid}
            if not mates or any(by_id[m].circle == circle for m in mates if m in by_id) or partners[rid] & mates:
                continue
            elsewhere = sorted({home(x) for x in ids if x != rid} - {h}, key=lambda t: geo.order.get(t, 0))
            if elsewhere:
                where = "、".join(tname(t) for t in elsewhere[:3]) + ("等" if len(elsewhere) > 3 else "")
                add("warn", "alone", f"{by_id[rid].name}（{circle}）在{tname(h)}沒有同圈子的人；同圈子的坐在{where}", [h, *elsewhere], [rid], f"alone:{rid}")

    # 座位需求
    no_main = []
    for r in rsvps:
        need, h = r.seat_need or "", home(r.id)
        if not need or h is None:
            continue
        if need == "main":
            if not geo.main:
                no_main.append(r)
            elif h not in geo.main:
                add("warn", "need", f"{r.name} 標了「主桌」，現在坐{tname(h)}", [h], [r.id], f"need:{r.id}")
        elif need == "front" and geo.front.get(h, 0) > FRONT_SHARE:
            add("warn", "need", f"{r.name} 標了「靠近舞台」，{tname(h)}離舞台比較遠", [h], [r.id], f"need:{r.id}")
        elif need == "door" and geo.has_door and geo.door.get(h, 0) > FRONT_SHARE:
            add("warn", "need", f"{r.name} 標了「靠近入口」，{tname(h)}離入口比較遠", [h], [r.id], f"need:{r.id}")
    if no_main:
        add("warn", "need", f"{'、'.join(r.name for r in no_main)} 標了「主桌」，但這一廳沒有名稱含「主桌」的桌子；把那一桌改名叫主桌，一鍵安排與檢查才認得",
            [home(r.id) for r in no_main], [r.id for r in no_main], "need:nomain")

    # 排完才看：桌子太空（喜宴依桌計價，坐一半的桌子併掉就省一桌）。
    # 主桌不會拿去併，空著的位子是提醒還有家長、媒人沒排；標了「排定」的桌是新人自己定的，不多嘴
    if complete:
        for o in geo.tables:
            n = sum(at.get(o.id, 0) for at in seated.values())
            cap = seat_count(o)
            if o.kind == "chair" or o.meta.get("keep_seats"):
                continue
            if o.id in geo.main:
                if n < cap:
                    add("warn", "sparse", f"{tname(o.id)}還有 {cap - n} 個空位：主桌通常坐雙方家長、主婚人、媒人，可以在「座位需求」標主桌再一鍵安排",
                        [o.id], [], f"sparse:{o.id}")
            elif cap >= 6 and 0 < n <= cap / 2:
                add("warn", "sparse", f"{tname(o.id)}只坐 {n} 位（{cap} 人桌）：喜宴多半依桌計價，可以考慮併到別桌", [o.id], [], f"sparse:{o.id}")

    order = ["apart", "together", "far", "near", "need", "split", "alone", "sparse"]
    issues.sort(key=lambda x: (x["level"] != "no", order.index(x["kind"])))
    return issues, status


def layout_extras(db: Session, objects: list[SeatObject], rsvps: list[Rsvp], seated: dict[int, dict[int, int]], complete: bool) -> dict:
    """排位規則相關的資料，併進後台的座位圖版面：規則、圈子、檢查結果、桌子遠近。"""
    rules = load_rules(db)
    geo = Geo(objects)
    issues, status = check(geo, rsvps, rules, seated, complete)
    # 規則的成員可能有人改成不出席：名字還是要顯示，所以另外撈
    member_ids = {i for r in rules for i in r.rsvp_ids}
    by_id = {r.id: r for r in rsvps}
    missing = member_ids - set(by_id)
    if missing:
        by_id.update({r.id: r for r in db.scalars(select(Rsvp).where(Rsvp.id.in_(missing))).all()})
    return {
        "rules": [rule_out(r, by_id, status.get(r.id, "pending")) for r in rules],
        "circles": circles_out(rsvps),
        "issues": issues,
        "geo": geo.out(),
    }


# ---------------- 一鍵安排 ----------------
def _pick_run(free: list[int], k: int, n: int) -> list[int]:
    """從空位裡挑 k 個盡量相連的位子（座位是繞桌一圈，所以頭尾算相連）。"""
    if k >= len(free):
        return list(free)
    fs = set(free)
    for start in free:
        run = [(start + j) % n for j in range(k)]
        if all(x in fs for x in run):
            return run
    return list(free[:k])


class _Unit:
    """一份要一起放的人：一組賓客，或用「一定同桌」串在一起的幾組。"""

    def __init__(self, rids: list[int], persons: list[tuple[int, int]], by_id: dict[int, Rsvp], movable: bool = True):
        self.rids = rids
        self.persons = persons
        self.movable = movable  # 一桌坐不下被拆開放的，第二輪不再搬動
        self.table: int | None = None
        members = [by_id[i] for i in rids]
        self.need = max((m.seat_need or "" for m in members), key=lambda n: NEED_RANK.get(n, 0))
        # 多數決；平手取排在前面的那組（不用 set，字串的 hash 每次啟動不同，結果會不固定）
        sides = [m.side for m in members]
        self.side = max(sides, key=sides.count)
        circles = [m.circle for m in members if m.circle]
        self.circle = max(circles, key=circles.count) if circles else ""
        self.circles: dict[str, int] = {}  # 每個圈子在這一份裡有幾組（算落單用）
        for c in circles:
            self.circles[c] = self.circles.get(c, 0) + 1

    @property
    def size(self) -> int:
        return len(self.persons)


class _Planner:
    """一鍵安排：先一份一份放到分數最高的桌子，再反覆試著「搬到別桌」或「兩份對調」，直到沒有更好的換法。
    分數 = 這份人坐某桌的單獨分數（主桌、靠舞台、靠入口、桌序）＋ 跟每一組已經坐好的人之間的分數（規則、圈子、男女方）。
    兩兩之間的分數是對稱的，所以搬一份人只要重算這份人自己的分數，就是整體分數的變化。"""

    def __init__(self, geo: Geo, rsvps: list[Rsvp], rules: list[SeatRule], fixed: list[tuple[int, int, int, int]], locked: set[int], by_side: bool):
        self.geo = geo
        self.by_side = by_side
        self.by_id = {r.id: r for r in rsvps}
        self.tables = [o.id for o in sorted(geo.tables, key=lambda o: geo.order[o.id]) if o.id not in locked]
        self.cap = {o.id: seat_count(o) for o in geo.tables}
        self.load: dict[int, int] = defaultdict(int)
        self.count: dict[int, dict[int, int]] = defaultdict(dict)   # 桌 → {rsvp: 幾位}
        self.where: dict[int, dict[int, int]] = defaultdict(dict)   # rsvp → {桌: 幾位}
        self.units_at: dict[int, list[_Unit]] = defaultdict(list)
        self.used_idx: dict[int, set[int]] = defaultdict(set)
        self.circ: dict[int, dict[str, int]] = defaultdict(dict)  # 桌 → {圈子: 幾組}（算落單用）
        totals: dict[str, int] = defaultdict(int)
        for r in rsvps:
            if r.circle:
                totals[r.circle] += 1
        self.circle_groups = totals  # 圈子只有一組的，坐哪都不算落單
        for rid, _pno, tid, idx in fixed:
            self.used_idx[tid].add(idx)
            self._add(rid, tid, 1)
        self.partners: dict[int, list[tuple[int, str]]] = defaultdict(list)
        for rule in rules:
            ms = [i for i in rule.rsvp_ids if i in self.by_id]
            for a in ms:
                self.partners[a].extend((b, rule.kind) for b in ms if b != a)
        self.left_over = 0
        self.circle_left: dict[str, int] = defaultdict(int)  # 每個圈子還有幾位沒放（第一輪用）

    # ----- 狀態 -----
    def _add(self, rid: int, tid: int, n: int) -> None:
        c = self.count[tid]
        before = rid in c
        c[rid] = c.get(rid, 0) + n
        if c[rid] <= 0:
            del c[rid]
        circle = self.by_id[rid].circle if rid in self.by_id else ""
        if circle and before != (rid in c):
            cc = self.circ[tid]
            cc[circle] = cc.get(circle, 0) + (1 if rid in c else -1)
        w = self.where[rid]
        w[tid] = w.get(tid, 0) + n
        if w[tid] <= 0:
            del w[tid]
        if not w:
            del self.where[rid]
        self.load[tid] += n

    def free(self, tid: int) -> int:
        return self.cap[tid] - self.load[tid]

    def put(self, u: _Unit, tid: int) -> None:
        u.table = tid
        self.units_at[tid].append(u)
        for rid, _ in u.persons:
            self._add(rid, tid, 1)

    def take(self, u: _Unit) -> None:
        self.units_at[u.table].remove(u)
        for rid, _ in u.persons:
            self._add(rid, u.table, -1)
        u.table = None

    # ----- 分數 -----
    def unary(self, u: _Unit, tid: int) -> float:
        g = self.geo
        sc = 0.0
        if tid in g.main:
            sc += W_MAIN_YES if u.need == "main" else W_MAIN_RESERVED
        elif u.need == "main":
            # 這一廳沒有主桌：當作加倍要緊的「靠近舞台」
            sc += W_MAIN_ELSEWHERE if g.main else 2 * self._zone(g.front[tid])
        if u.need == "front":
            sc += self._zone(g.front[tid])
        elif u.need == "door":
            sc += self._zone(g.door[tid])
        if g.by_id[tid].kind == "chair":
            sc += W_CHAIR
        rank = g.order[tid]
        sc -= W_ORDER * ((1 - rank) if self.by_side and u.side == "bride" else rank)
        return sc

    @staticmethod
    def _zone(rank: float) -> float:
        return (W_NEED_ZONE if rank <= FRONT_SHARE else 0) + W_NEED_GRADE * (1 - rank)

    def pair(self, u: _Unit, tid: int) -> float:
        """u 坐 tid 時，跟其他已經坐好的人之間的分數（u 要先從桌上拿掉再算）。"""
        adj = self.geo.adj[tid]
        mine = set(u.rids)
        here = self.count[tid]
        sc = 0.0
        for rid in u.rids:
            me = self.by_id[rid]
            for other, kind in self.partners[rid]:
                at = self.where.get(other)
                if other in mine or not at:
                    continue
                same = tid in at
                near = same or any(t in adj for t in at)
                if kind == "apart":
                    sc += W_APART if same else 0
                elif kind == "far":
                    sc += W_FAR_SAME if same else W_FAR_ADJ if near else 0
                elif kind == "together":
                    sc += W_TOGETHER_SAME if same else W_TOGETHER_ADJ if near else 0
                elif kind == "near":
                    sc += W_NEAR_SAME if same else W_NEAR_ADJ if near else 0
            for other in here:
                o = self.by_id.get(other)
                if other in mine or o is None:
                    continue
                if me.circle and o.circle:
                    sc += W_CIRCLE_SAME if me.circle == o.circle else W_CIRCLE_MIX
                if self.by_side and OPPOSITE_SIDE.get(me.side) == o.side:
                    sc += W_SIDE_MIX
            if me.circle:
                for t2 in adj:
                    for other in self.count[t2]:
                        o = self.by_id.get(other)
                        if other not in mine and o is not None and o.circle == me.circle:
                            sc += W_CIRCLE_ADJ
        return sc

    def score(self, u: _Unit, tid: int) -> float:
        return self.unary(u, tid) + self.pair(u, tid)

    def _alone(self, circle: str, n: int) -> int:
        """某桌某圈子有 n 組時，有幾組算落單（只剩自己一組、而且這個圈子不只一組）。"""
        return 1 if n == 1 and self.circle_groups.get(circle, 0) > 1 else 0

    def alone_delta(self, u: _Unit, a: int | None, b: int, v: _Unit | None = None) -> float:
        """u 從 a 搬到 b（v 不是 None 就是 v 從 b 換到 a）之後，落單的組數變化 × 扣分。
        落單只跟同一桌同圈子有幾組有關，所以只要看 a、b 兩桌、u 與 v 的那幾個圈子；呼叫前 u、v 都要先從桌上拿掉。"""
        circles = set(u.circles) | (set(v.circles) if v else set())
        d = 0
        for c in circles:
            mu, mv = u.circles.get(c, 0), (v.circles.get(c, 0) if v else 0)
            cb = self.circ[b].get(c, 0)
            if a is None:
                d += self._alone(c, cb + mu) - self._alone(c, cb)
                continue
            ca = self.circ[a].get(c, 0)
            before = self._alone(c, ca + mu) + self._alone(c, cb + mv)
            after = self._alone(c, ca + mv) + self._alone(c, cb + mu)
            d += after - before
        return W_ALONE * d

    # ----- 第一輪：一份一份放 -----
    def best_table(self, u: _Unit) -> int | None:
        best, best_sc = None, -math.inf
        # 這個圈子還有幾位沒放（含自己）：一桌坐得下就找坐得下的桌；坐不下一桌就找空桌
        room = min(self.circle_left.get(u.circle, 0), max(self.cap.values(), default=0)) if u.circle else 0
        for tid in self.tables:
            if self.free(tid) < u.size:
                continue
            sc = self.score(u, tid) + self.alone_delta(u, None, tid)
            if self.load[tid] > 0:
                sc += W_FILL
            if self.free(tid) == u.size:
                sc += W_EXACT
            if room and self.free(tid) >= min(room, self.cap[tid]):
                sc += W_ROOM
            if sc > best_sc + 1e-9:
                best, best_sc = tid, sc
        return best

    def place_split(self, u: _Unit, placed: list[_Unit]) -> None:
        """整份放不下：一定同桌串起來的先拆回一組一組；一組還是放不下就照人拆，盡量坐隔壁桌。"""
        parts = [_Unit([rid], [p for p in u.persons if p[0] == rid], self.by_id) for rid in u.rids] if len(u.rids) > 1 else [u]
        for part in sorted(parts, key=lambda x: -x.size):
            tid = self.best_table(part)
            if tid is not None:
                self.put(part, tid)
                placed.append(part)
                continue
            persons = list(part.persons)
            while persons:
                cands = [t for t in self.tables if self.free(t) > 0]
                if not cands:
                    self.left_over += len(persons)
                    break

                def split_score(t, persons=persons, part=part):
                    chunk = _Unit(part.rids, persons[: self.free(t)], self.by_id)
                    sc = self.score(chunk, t) + 3 * min(self.free(t), len(persons))
                    if any(t2 in self.geo.adj[t] for rid in part.rids for t2 in self.where.get(rid, {})):
                        sc += W_TOGETHER_ADJ
                    return sc

                t = max(cands, key=split_score)
                k = min(self.free(t), len(persons))
                chunk = _Unit(part.rids, persons[:k], self.by_id, movable=False)
                self.put(chunk, t)
                placed.append(chunk)
                persons = persons[k:]

    # ----- 第二輪：搬動、對調、整桌對調 -----
    def improve(self, units: list[_Unit]) -> None:
        deadline = time.monotonic() + SEARCH_SECONDS
        movable = [u for u in units if u.movable and u.table is not None]
        for _ in range(40):
            moved = self._improve_units(movable, deadline)
            swapped = self._swap_tables(deadline)
            if not (moved or swapped) or time.monotonic() > deadline:
                return

    def _improve_units(self, movable: list[_Unit], deadline: float) -> bool:
        """一份一份試：搬到別桌、或跟別桌的一份對調，有變好就換。"""
        improved = False
        for u in movable:
            if time.monotonic() > deadline:
                break
            a = u.table
            self.take(u)
            base = self.score(u, a)
            wish = sorted(((self.score(u, b) + self.alone_delta(u, a, b), b) for b in self.tables if b != a), key=lambda x: -x[0])
            best_d, best_b, best_v = 0.5, None, None  # 至少好 0.5 分才換，避免兩個差不多的位置來回跳
            for sc, b in wish:
                d = sc - base
                if d <= best_d:
                    break
                # 第二輪不開新桌（那是第一輪的事）；除非能解決「不要同桌」這種大問題
                if self.free(b) >= u.size and (self.load[b] > 0 or d > 100):
                    best_d, best_b = d, b
                    break
            # 對調：只跟「最想去的那幾桌」上的人試，不然每兩份都試一次太慢
            for _sc, b in wish[:3]:
                if _sc - base <= 0.5:
                    break
                for v in list(self.units_at[b]):
                    if not v.movable or self.free(a) < v.size or self.free(b) + v.size < u.size:
                        continue
                    self.take(v)
                    # u 跟 v 之間的分數換前換後一樣（一個在 a、一個在 b），兩個都拿掉再算剛好不用管它
                    d = (self.score(u, b) + self.score(v, a) - self.score(u, a) - self.score(v, b)
                         + self.alone_delta(u, a, b, v))
                    self.put(v, b)
                    if d > best_d:
                        best_d, best_b, best_v = d, b, v
            if best_b is None:
                self.put(u, a)
                continue
            if best_v is not None:
                self.take(best_v)
                self.put(best_v, a)
            self.put(u, best_b)
            improved = True
        return improved

    def _swap_tables(self, deadline: float) -> bool:
        """整桌對調：一桌人原封不動換到另一張桌子。同桌的人不變，只換位置，
        所以兩個圈子要「坐附近」、整桌長輩要靠舞台、男方的桌子要排在一起，都靠這一步。
        只換一鍵安排自己放的桌（有手排的人、拆開放的就不動）。"""
        def free_to_swap(t):
            return not self.used_idx[t] and all(u.movable for u in self.units_at[t])

        def local(ts):
            return sum(self.score(w, t) for t in ts for w in self.units_at[t])

        def swap(a, b):
            ua, ub = list(self.units_at[a]), list(self.units_at[b])
            for w in ua + ub:
                self.take(w)
            for w in ua:
                self.put(w, b)
            for w in ub:
                self.put(w, a)

        improved = False
        cands = [t for t in self.tables if free_to_swap(t)]
        for i, a in enumerate(cands):
            for b in cands[i + 1:]:
                if time.monotonic() > deadline:
                    return improved
                if (not self.units_at[a] and not self.units_at[b]) or self.load[a] > self.cap[b] or self.load[b] > self.cap[a]:
                    continue
                # 同一桌裡的分數換前換後一樣，兩桌之間的也一樣（隔壁桌是對稱的），變的只有跟其他桌的關係與位置
                before = local((a, b))
                swap(a, b)
                if local((a, b)) - before > 0.5:
                    improved = True
                else:
                    swap(a, b)
        return improved

    # ----- 整個流程 -----
    def run(self, pending: dict[int, list[int]]) -> list[_Unit]:
        # 一定同桌的串在一起（A 跟 B、B 跟 C → 三組一起放）
        root = {rid: rid for rid in pending}

        def find(x):
            while root[x] != x:
                root[x] = root[root[x]]
                x = root[x]
            return x

        for rid in pending:
            for other, kind in self.partners[rid]:
                if kind == "together" and other in pending:
                    root[find(other)] = find(rid)
        clusters: dict[int, list[int]] = defaultdict(list)
        for rid in pending:  # pending 照回覆先後排好了，同一份裡也照這個順序坐
            clusters[find(rid)].append(rid)
        units = [_Unit(rids, [(rid, pno) for rid in rids for pno in pending[rid]], self.by_id) for rids in clusters.values()]

        for u in units:
            self.circle_left[u.circle] += u.size
        circle_rank = {c: i for i, c in enumerate(sorted((c for c in self.circle_left if c), key=lambda c: (-self.circle_left[c], c)))}

        fixed_rids = set(self.where)  # 手排好、這次不動的人

        def priority(u: _Unit):
            kinds = {k for rid in u.rids for _, k in self.partners[rid]}
            anchored = any(o in fixed_rids for rid in u.rids for o, k in self.partners[rid] if k in ("together", "near"))
            # 夥伴（一定同桌、坐附近）已經坐好了：這次放的人裡，誰的夥伴已經有位子
            linked = any(self.where.get(o) for rid in u.rids for o, k in self.partners[rid] if k in ("together", "near"))
            # 主桌、要跟手排好的人一起的先放；再來一個圈子一個圈子整批放（大的先），圈子才不會被先放的散客佔掉桌子；
            # 有位置需求、有人不能同桌的散客接著放，最後才是沒有限制的。
            # 同一個圈子裡，夥伴已經坐好的、有位置需求的先放（例如親戚裡的阿公阿嬤要靠舞台），同圈子的再跟過去，
            # 整個圈子就會長在夥伴旁邊、舞台前面
            p = 0 if u.need == "main" else 1 if anchored else 2 if u.circle else 3 if (u.need or kinds & {"apart", "far"}) else 4
            return (p, circle_rank.get(u.circle, len(circle_rank)), not linked, not u.need, -u.size, u.rids[0])

        placed: list[_Unit] = []
        todo = list(units)
        while todo:
            # 每放一份重新挑下一份：前面放下去之後，誰的夥伴「已經坐好」會改變
            u = min(todo, key=priority)
            todo.remove(u)
            tid = self.best_table(u)
            if tid is None:
                self.place_split(u, placed)
            else:
                self.put(u, tid)
                placed.append(u)
            if u.circle:
                self.circle_left[u.circle] -= u.size
        self.improve(placed)
        return placed


def auto_assign(db: Session, hall: SeatHall, *, by_side: bool, clear_first: bool) -> tuple[int, int]:
    """一鍵安排這一廳還沒有位子的人。標了「排定」的桌子不動（不清、不加人）。回傳（放了幾位, 還有幾位沒位子）。"""
    objects = load_objects(db, hall.id)
    locked = {o.id for o in objects if o.meta.get("keep_seats")}
    if clear_first:
        for o in objects:
            if o.id not in locked:
                for a in list(o.assignments):
                    db.delete(a)
        db.commit()
        objects = load_objects(db, hall.id)
    geo = Geo(objects)
    rsvps = db.scalars(select(Rsvp).where(Rsvp.attending.is_(True), Rsvp.is_test.is_(False)).order_by(Rsvp.created_at.asc(), Rsvp.id.asc())).all()
    fixed = [(a.rsvp_id, a.person_no, o.id, a.seat_index) for o in objects for a in o.assignments]
    seated = {(rid, pno) for rid, pno, _, _ in fixed}
    pending = {}
    for r in rsvps:
        todo = [p["person_no"] for p in persons_for(r) if (r.id, p["person_no"]) not in seated]
        if todo:
            pending[r.id] = todo
    planner = _Planner(geo, rsvps, load_rules(db), fixed, locked, by_side)
    units = planner.run(pending)
    # 座號：同一份的人坐連號（一家人、一定同桌的坐在一起）；人多的先挑，比較容易挑到連號
    placed = 0
    for tid in planner.tables:
        free = sorted(set(range(planner.cap[tid])) - planner.used_idx[tid])
        for u in sorted((u for u in units if u.table == tid), key=lambda u: -u.size):
            run = _pick_run(free, u.size, planner.cap[tid])
            for (rid, pno), idx in zip(u.persons, run):
                db.add(SeatAssignment(hall_id=hall.id, object_id=tid, seat_index=idx, rsvp_id=rid, person_no=pno))
                free.remove(idx)
                placed += 1
    db.commit()
    return placed, planner.left_over
