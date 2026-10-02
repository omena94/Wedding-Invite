"""排位規則：一定同桌／不要同桌／坐附近／離遠一點、圈子、座位需求、排定的桌子；檢查與一鍵安排要照著做。
規則與圈子只給能排座位的人看（備註常是「前任」這種私事），幫手帶位的唯讀畫面不帶。隔離 SQLite，不碰正式資料。"""
import os

os.environ.update(DATABASE_URL="sqlite://", SECRET_KEY="local-test-secret-key-not-for-deployment-2026",
                  TELEGRAM_BOT_TOKEN="", TELEGRAM_CHAT_ID="", SMTP_USER="", SMTP_PASSWORD="")

from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app import cache
from app.database import Base, get_db
from app.main import app
from app.models import Rsvp
from app.security import ROLE_HELPER, create_token

P = "/api/planner/seating"


@pytest.fixture
def s(monkeypatch, tmp_path):
    from app import config

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    db = Session(engine, expire_on_commit=False)
    app.dependency_overrides[get_db] = lambda: db
    monkeypatch.setattr(config.settings, "upload_dir", str(tmp_path))
    monkeypatch.setattr(cache, "invalidate_stats", lambda: None)
    monkeypatch.setattr(cache, "get_cached_stats", lambda: None)
    monkeypatch.setattr(cache, "set_cached_stats", lambda *_: None)
    c = TestClient(app)
    h = {"Authorization": "Bearer " + create_token()}

    def guest(name, side="groom", adults=1, kids=0, circle="", need=""):
        r = Rsvp(name=name, side=side, attending=True, adult_count=adults, child_count=kids, circle=circle, seat_need=need)
        db.add(r)
        db.commit()
        return r.id

    def table(label, x=0, y=0, seats=10, kind="round"):
        r = c.post(f"{P}/objects", json={"kind": kind, "label": label, "x": x, "y": y, "w": 120, "h": 120, "seats": seats}, headers=h)
        assert r.status_code == 201, r.text
        return r.json()["id"]

    def put(rid, oid):
        r = c.post(f"{P}/assign-group", json={"object_id": oid, "rsvp_id": rid}, headers=h)
        assert r.status_code == 200, r.text
        return r.json()

    def rule(kind, ids, note="", expect=201):
        r = c.post(f"{P}/rules", json={"kind": kind, "rsvp_ids": ids, "note": note}, headers=h)
        assert r.status_code == expect, r.text
        return r.json()

    x = SimpleNamespace(c=c, h=h, guest=guest, table=table, put=put, rule=rule,
                        world=SimpleNamespace(db=db, helper={"Authorization": "Bearer " + create_token(ROLE_HELPER)}))
    x.layout = lambda: c.get(P, headers=h).json()
    yield x
    app.dependency_overrides.clear()
    c.close()
    db.close()
    engine.dispose()


def _kinds(layout, level=None):
    return [i["kind"] for i in layout["issues"] if level is None or i["level"] == level]


def _table_of(layout, rid):
    """這組人坐哪幾桌（桌 id 集合）。"""
    return {o["id"] for o in layout["objects"] for a in o.get("assignments", []) if a["rsvp_id"] == rid}


def test_rule_crud_and_conflicts(s):
    a, b, c3 = s.guest("王小明"), s.guest("李大華"), s.guest("陳阿姨", side="bride")
    l = s.rule("apart", [a, b], note="前任")
    assert [(r["kind"], r["note"], [m["name"] for m in r["members"]]) for r in l["rules"]] == [("apart", "前任", ["王小明", "李大華"])]
    rid = l["rules"][0]["id"]
    # 同一條再設一次、或設成矛盾的規則：擋下並說清楚為什麼
    assert "一樣" in s.rule("apart", [b, a], expect=409)["detail"]
    assert "不能同時" in s.rule("together", [a, b], expect=409)["detail"]
    # 透過一定同桌串起來的矛盾：a 跟 c3 同桌、c3 跟 b 同桌 → a 跟 b 等於同桌，但 a、b 不要同桌
    s.rule("together", [a, c3])
    assert "串在一起" in s.rule("together", [c3, b], expect=409)["detail"]
    # 不到兩組、重複的人、找不到的人
    assert s.c.post(f"{P}/rules", json={"kind": "near", "rsvp_ids": [a, a]}, headers=s.h).status_code == 400
    assert s.c.post(f"{P}/rules", json={"kind": "near", "rsvp_ids": [a, 99999]}, headers=s.h).status_code == 400
    # 改備註、改種類（改成離遠一點跟 a-c3 的一定同桌不衝突，因為成員是 a、b）
    l = s.c.patch(f"{P}/rules/{rid}", json={"kind": "far", "note": "兩家有心結"}, headers=s.h).json()
    assert next(r for r in l["rules"] if r["id"] == rid)["kind"] == "far"
    # 刪掉
    l = s.c.delete(f"{P}/rules/{rid}", headers=s.h).json()
    assert rid not in [r["id"] for r in l["rules"]]
    # 賓客被刪掉，規則只剩一組 → 自動清掉
    s.world.db.delete(s.world.db.get(Rsvp, c3))
    s.world.db.commit()
    assert s.layout()["rules"] == []


def test_check_finds_broken_rules(s):
    t1, t2, t3, t4 = s.table("1", x=0), s.table("2", x=200), s.table("3", x=400), s.table("4", x=600)
    a, b = s.guest("王小明"), s.guest("李大華")
    s.rule("apart", [a, b], note="前任")
    s.put(a, t1)
    l = s.put(b, t1)
    apart = next(i for i in l["issues"] if i["kind"] == "apart")
    assert apart["level"] == "no" and "前任" in apart["text"] and apart["object_ids"] == [t1] and set(apart["rsvp_ids"]) == {a, b}
    assert next(r for r in l["rules"])["status"] == "broken"
    # 隔壁桌就不算同桌
    l = s.c.post(f"{P}/assign-group", json={"object_id": t2, "rsvp_id": b, "move_all": True}, headers=s.h).json()
    assert "apart" not in _kinds(l) and l["rules"][0]["status"] == "ok"
    # 坐附近：1 和 2 是隔壁桌（桌距 200），1 和 4 太遠
    c3, d = s.guest("同事甲"), s.guest("同事乙")
    s.rule("near", [c3, d])
    s.put(c3, t1)
    l = s.put(d, t2)
    assert "near" not in _kinds(l)
    l = s.c.post(f"{P}/assign-group", json={"object_id": t4, "rsvp_id": d, "move_all": True}, headers=s.h).json()
    assert "near" in _kinds(l, "warn")
    # 離遠一點：隔壁桌是提醒，同桌是一定要處理
    e, f = s.guest("前同事"), s.guest("老同事")
    s.rule("far", [e, f])
    s.put(e, t3)
    l = s.put(f, t4)
    assert "far" in _kinds(l, "warn")
    l = s.c.post(f"{P}/assign-group", json={"object_id": t3, "rsvp_id": f, "move_all": True}, headers=s.h).json()
    assert "far" in _kinds(l, "no")
    # 一定同桌被拆開
    g1, g2 = s.guest("新郎表哥"), s.guest("表嫂")
    s.rule("together", [g1, g2])
    s.put(g1, t1)
    l = s.put(g2, t4)
    assert "together" in _kinds(l, "no")


def test_check_alone_split_needs_and_sparse(s):
    t1, t2 = s.table("1", x=0, seats=4), s.table("2", x=200, seats=10)
    # 舞台在兩桌上方，1 號桌比較近
    s.c.post(f"{P}/objects", json={"kind": "stage", "label": "舞台", "x": 0, "y": -300, "w": 200, "h": 80}, headers=s.h)
    a = s.guest("大學同學甲", circle="大學同學", adults=2)
    b = s.guest("大學同學乙", circle="大學同學")
    work = s.guest("公司同事", circle="公司同事")
    s.put(a, t2)
    s.put(b, t2)
    l = s.put(work, t2)
    # 同圈子同桌不算落單；公司同事那個圈子只有一組，沒有「同圈子的坐別桌」，也不算
    assert "alone" not in _kinds(l)
    # 丙也是大學同學，卻跟不認識的高中同學坐 1 號桌 → 落單
    c3 = s.guest("大學同學丙", circle="大學同學")
    hs = s.guest("高中同學", circle="高中同學")
    s.put(c3, t1)
    l = s.put(hs, t1)
    assert [i["rsvp_ids"] for i in l["issues"] if i["kind"] == "alone"] == [[c3]]
    # 一家 3 位被拆開（1 號桌只剩 2 個空位）
    fam = s.guest("林家", adults=3)
    l = s.c.post(f"{P}/assign-group", json={"object_id": t1, "rsvp_id": fam, "partial": True}, headers=s.h).json()
    # 還有人沒位子：2 號桌坐不到一半也先不提醒（排到一半每桌都空空的）
    assert l["summary"]["unassigned"] == 1 and "sparse" not in _kinds(l)
    l = s.put(fam, t2)
    assert "split" in _kinds(l)
    # 全部排完了：2 號桌 10 人桌只坐 5 位 → 提醒可以併桌
    assert [i["object_ids"] for i in l["issues"] if i["kind"] == "sparse"] == [[t2]]
    # 座位需求：公司同事要靠近舞台，但 2 號桌離舞台比較遠
    l = s.c.patch(f"{P}/guests", json={"rsvp_ids": [work], "seat_need": "front"}, headers=s.h).json()
    assert any(i["kind"] == "need" and i["rsvp_ids"] == [work] for i in l["issues"])
    # 標了主桌，但這一廳沒有主桌
    l = s.c.patch(f"{P}/guests", json={"rsvp_ids": [a], "seat_need": "main"}, headers=s.h).json()
    assert any(i["key"] == "need:nomain" for i in l["issues"])


def test_circles_bulk_rename_and_dissolve(s):
    a, b, c3 = s.guest("甲"), s.guest("乙"), s.guest("丙")
    l = s.c.patch(f"{P}/guests", json={"rsvp_ids": [a, b], "circle": " 大學同學 "}, headers=s.h).json()
    assert l["circles"] == [{"name": "大學同學", "groups": 2, "people": 2}]
    assert {g["rsvp_id"]: g["circle"] for g in l["guests"]}[a] == "大學同學"
    s.c.patch(f"{P}/guests", json={"rsvp_ids": [c3], "circle": "研究所"}, headers=s.h)
    # 改名成已有的名字 = 合併
    l = s.c.post(f"{P}/circles/rename", json={"name": "研究所", "to": "大學同學"}, headers=s.h).json()
    assert l["circles"] == [{"name": "大學同學", "groups": 3, "people": 3}]
    # 解散
    l = s.c.post(f"{P}/circles/rename", json={"name": "大學同學", "to": ""}, headers=s.h).json()
    assert l["circles"] == [] and all(g["circle"] == "" for g in l["guests"])
    assert s.c.post(f"{P}/circles/rename", json={"name": "不存在", "to": "x"}, headers=s.h).status_code == 404
    assert s.c.patch(f"{P}/guests", json={"rsvp_ids": [a], "seat_need": "vip"}, headers=s.h).status_code == 422


def test_auto_assign_follows_rules_and_circles(s):
    # 一排四桌、每桌 6 位；舞台在 1 號桌那一側
    s.c.post(f"{P}/objects", json={"kind": "stage", "label": "舞台", "x": -300, "y": 0, "w": 80, "h": 120}, headers=s.h)
    t = [s.table(str(i + 1), x=i * 200, seats=6) for i in range(4)]
    # 大學同學 6 位（3 組）、公司同事 6 位（3 組）：同圈子要坐同一桌
    uni = [s.guest(f"大學{i}", circle="大學同學", adults=2) for i in range(3)]
    work = [s.guest(f"同事{i}", circle="公司同事", adults=2) for i in range(3)]
    # 同圈子的兩組設了不要同桌：一定要拆開，就算同圈子
    ex1, ex2 = s.guest("前任甲", circle="高中同學"), s.guest("前任乙", circle="高中同學")
    s.rule("apart", [ex1, ex2], note="前任")
    # 分開回覆的情侶：一定同桌
    bf, gf = s.guest("男友"), s.guest("女友", side="bride")
    s.rule("together", [bf, gf])
    # 要早走的阿嬤：靠近入口（入口在最右邊）
    s.c.post(f"{P}/objects", json={"kind": "entrance", "label": "入口", "x": 900, "y": 0, "w": 80, "h": 60}, headers=s.h)
    grandma = s.guest("阿嬤", need="door")
    r = s.c.post(f"{P}/auto-assign", json={"by_side": False, "keep_groups": True}, headers=s.h)  # 舊前端還會送 keep_groups，要能用
    assert r.status_code == 200, r.text
    l = r.json()
    assert l["left_over"] == 0 and l["summary"]["unassigned"] == 0
    assert len({frozenset(_table_of(l, g)) for g in uni}) == 1, "大學同學要同一桌"
    assert len({frozenset(_table_of(l, g)) for g in work}) == 1, "公司同事要同一桌"
    assert _table_of(l, ex1) != _table_of(l, ex2), "不要同桌的要分開"
    assert _table_of(l, bf) == _table_of(l, gf), "一定同桌的要在一起"
    assert _table_of(l, grandma) <= {t[2], t[3]}, "靠近入口的放靠門的那幾桌"
    assert "need" not in _kinds(l)
    assert [i for i in l["issues"] if i["level"] == "no"] == []
    # 情侶坐連號（同一份人坐在一起）
    seats = sorted(a["seat_index"] for o in l["objects"] for a in o.get("assignments", []) if a["rsvp_id"] in (bf, gf))
    assert seats == list(range(seats[0], seats[0] + 2)) or seats == [0, 5]


def test_auto_assign_reserves_main_table_and_keeps_locked_tables(s):
    main = s.table("主桌", x=0, seats=4)
    t1, t2 = s.table("1", x=200, seats=4), s.table("2", x=400, seats=4)
    parents = s.guest("雙方家長", adults=2, need="main")
    friends = [s.guest(f"朋友{i}", adults=2) for i in range(4)]
    l = s.c.post(f"{P}/auto-assign", json={}, headers=s.h).json()
    assert l["summary"]["unassigned"] == 0
    assert _table_of(l, parents) == {main}
    # 主桌留給標了主桌的人：別桌坐得下，就不會把朋友塞進主桌
    assert all(main not in _table_of(l, f) for f in friends)
    # 排完了主桌還有空位：提醒還有家長、媒人沒排（不是叫人併桌）
    hint = next(i for i in l["issues"] if i["kind"] == "sparse" and i["object_ids"] == [main])
    assert "2 個空位" in hint["text"] and "併" not in hint["text"]
    # 真的沒位子了才放主桌（總比沒位子好）
    extra = s.guest("臨時加的", adults=2)
    l = s.c.post(f"{P}/auto-assign", json={}, headers=s.h).json()
    assert _table_of(l, extra) == {main} and l["left_over"] == 0
    # 把主桌標成排定 → 清空重排不清主桌、也不往主桌加人；清空全部也不動主桌
    o = next(x for x in l["objects"] if x["id"] == main)
    s.c.patch(f"{P}/objects/{main}", json={"meta": {**o["meta"], "keep_seats": True}}, headers=s.h)
    l = s.c.post(f"{P}/auto-assign", json={"clear_first": True}, headers=s.h).json()
    assert _table_of(l, parents) == {main} and _table_of(l, extra) == {main}
    assert all(_table_of(l, f) <= {t1, t2} for f in friends) and l["left_over"] == 0
    l = s.c.delete(f"{P}/assignments", headers=s.h).json()
    assert l["summary"]["assigned"] == 4
    assert all(not _table_of(l, f) for f in friends)
    # 排定的桌子沒空位時，一鍵安排也不會把人放進去：只剩 1、2 號桌 8 個位子，4 組朋友剛好
    l = s.c.post(f"{P}/auto-assign", json={}, headers=s.h).json()
    assert l["placed"] == 8 and l["left_over"] == 0


def test_helper_view_has_no_rules(s):
    a, b = s.guest("王小明", circle="大學同學"), s.guest("李大華")
    s.rule("apart", [a, b], note="前任")
    t = s.table("1")
    s.put(a, t)
    s.put(b, t)
    r = s.c.get("/api/admin/seating", headers=s.world.helper)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "rules" not in body and "issues" not in body and "circles" not in body
    assert all("circle" not in g for g in body["guests"])
    assert "前任" not in r.text
    # 幫手也不能動規則（排座位的 API 要「擺桌椅、安排座位」權限）
    assert s.c.post(f"{P}/rules", json={"kind": "near", "rsvp_ids": [a, b]}, headers=s.world.helper).status_code == 403


def test_auto_assign_realistic_wedding(s):
    """接近真實規模：31 桌、近 300 位、十幾個圈子、十幾條規則。全部要有位子，規則全部做到。"""
    import random

    rnd = random.Random(7)
    s.c.post(f"{P}/objects", json={"kind": "stage", "label": "舞台", "x": 600, "y": 0, "w": 400, "h": 100}, headers=s.h)
    s.c.post(f"{P}/objects", json={"kind": "entrance", "label": "入口", "x": 700, "y": 1500, "w": 120, "h": 60}, headers=s.h)
    s.table("主桌", x=740, y=160, seats=12)
    for i in range(30):
        s.table(str(i + 1), x=100 + (i % 6) * 240, y=400 + (i // 6) * 220)
    circles = {"groom": ["男方大學", "男方公司", "男方親戚", "爸爸朋友", "男方高中", "男方球隊", "男方研究所"],
               "bride": ["女方大學", "女方公司", "女方親戚", "媽媽朋友", "女方高中", "女方舞社"]}
    ids, total = [], 4
    for i in range(120):
        side = rnd.choice(["groom", "bride"])
        adults, kids = rnd.choice([1, 1, 2, 2, 2, 3, 4]), rnd.choice([0, 0, 0, 1, 2])
        if total + adults + kids > 290:
            break
        total += adults + kids
        ids.append(s.guest(f"賓客{i}", side=side, adults=adults, kids=kids, circle=rnd.choice(circles[side] + [""]),
                           need=rnd.choice([""] * 12 + ["front", "door"])))
    s.guest("雙方家長", adults=4, need="main")
    for kind in ["apart"] * 5 + ["together"] * 4 + ["near"] * 4 + ["far"] * 3:
        s.c.post(f"{P}/rules", json={"kind": kind, "rsvp_ids": rnd.sample(ids, 2)}, headers=s.h)  # 偶爾抽到矛盾的會被擋，沒關係
    l = s.c.post(f"{P}/auto-assign", json={"by_side": True}, headers=s.h).json()
    assert l["placed"] == total and l["left_over"] == 0
    assert [r["status"] for r in l["rules"]] == ["ok"] * len(l["rules"])
    assert [i for i in l["issues"] if i["level"] == "no"] == []
    # 落單只會是少數（新人親手設的規則、位置需求比同圈子優先，會有取捨）
    assert len([i for i in l["issues"] if i["kind"] == "alone"]) <= 5
    # 再按一次一鍵安排（沒有人要排了）什麼都不會變
    again = s.c.post(f"{P}/auto-assign", json={"by_side": True}, headers=s.h).json()
    assert again["placed"] == 0 and again["summary"] == l["summary"]
