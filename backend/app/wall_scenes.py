"""大螢幕的場合：迎賓、新人進場、證婚致詞、用餐、敬酒、送客……每個場合自己的歌與畫面。

婚禮當天流程一段一段走，每一段要的音樂、畫面不一樣（進場要那首進場曲、致詞要把音樂調小聲、用餐時放祝福留言），
以前要幫手在手機遙控上一首一首插播、再切「畫面放什麼」，現在把這些先存成場合，當天按一下就整組換過去。

- 場合是一張表（models.WallScene），全部由新人自己新增、改名、排順序、挑歌，不寫死流程；TEMPLATES 只是範本（常見的喜宴流程）。
- 現在是哪個場合存在設定 wall_scene（{"id", "seq", "next"}）：seq 每切一次加一，大螢幕看到變了就換（切到同一個場合也算，
  重新從第一首播）；next 是「這首播完再換」排好的場合，由接收遙控的那台大螢幕在歌播完時來換。
- 場合沒設的東西照原本的設定：畫面放什麼照「內容」分頁、版面照「版面」分頁、配色照每首歌自己的；沒挑歌就不換歌。
- 大螢幕看到的「內容」是合併後的（effective_content），所以 feed、照片、/wish 開不開都照現在的場合。
"""
from __future__ import annotations

import json
import re

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .models import WallScene, WallSong
from .stage import WALL_MIXES, WALL_PACE_KEY, WALL_SCENE_KEY, get_setting, set_setting, wall_content

NAME_MAX = 20
MAX_SCENES = 40     # 訂婚、結婚各一套流程也用不完
SONGS_MAX = 200
PLATES_MAX = 300
PACES = ("fast", "normal", "slow")
THEMES = ("gold", "rose", "champagne", "coral", "lilac", "sage")  # 跟 routers/wall.py 的配色一樣
CONTENT_KEYS = ("lyrics", "messages", "photos")  # 場合能改的內容；註解、相簿照「內容」分頁

# 常見的流程（「一次加入常見流程」用）：after 是播完之後換到哪個場合（照名字對）。
# 只是範本，新人加進來之後可以改名、刪掉、調順序；歌要新人自己挑，所以範本不帶歌
TEMPLATE = [
    {"name": "迎賓入席"},
    {"name": "新人進場", "after": "用餐"},
    {"name": "證婚致詞", "duck": True},
    {"name": "用餐"},
    {"name": "二次進場", "after": "用餐"},
    {"name": "敬酒"},
    {"name": "送客"},
]

# ---------------- 現在是哪個場合 ----------------
def _int(v) -> int | None:
    return v if isinstance(v, int) and not isinstance(v, bool) else None


def state(db: Session) -> dict:
    """{"id": 現在的場合（沒有就是 None）, "seq": 切換編號, "next": 這首播完要換的 {"id": …}（沒排就是 None）}。
    場合被刪掉了就當作沒有（刪除時也會清，這裡是保險）。"""
    try:
        data = json.loads(get_setting(db, WALL_SCENE_KEY) or "{}")
    except ValueError:
        data = {}
    if not isinstance(data, dict):
        data = {}
    ids = set(db.scalars(select(WallScene.id)).all())
    sid = _int(data.get("id"))
    nxt = data.get("next")
    if isinstance(nxt, dict) and ("id" in nxt) and (nxt["id"] is None or _int(nxt["id"]) in ids):
        nxt = {"id": _int(nxt["id"])}
    else:
        nxt = None
    return {"id": sid if sid in ids else None, "seq": max(0, _int(data.get("seq")) or 0), "next": nxt}


def _save_state(db: Session, st: dict) -> None:
    set_setting(db, WALL_SCENE_KEY, json.dumps(st))


def active(db: Session) -> WallScene | None:
    sid = state(db)["id"]
    return db.get(WallScene, sid) if sid else None


def switch(db: Session, target: int | None, when: str, expect: dict | None = None) -> bool:
    """切場合。when：now 馬上換（seq 加一）／end 這首播完再換（記在 next）／cancel 取消排好的。
    expect（大螢幕在歌播完時來換）= {"from", "seq"}：狀態跟大螢幕看到的一樣、而且要換的就是排好的（或「播完之後」設的）那個才換；
    中間有人用手機切了、取消了，就不換（回 False），大螢幕照新的狀態走。好幾台大螢幕同時來換也只會換一次。"""
    st = state(db)
    if target is not None and db.get(WallScene, target) is None:
        raise HTTPException(404, "找不到這個場合")
    if expect is not None:
        if st["seq"] != expect.get("seq") or st["id"] != expect.get("from"):
            return False
        cur = db.get(WallScene, st["id"]) if st["id"] else None
        planned = st["next"]["id"] if st["next"] else (cur.after_id if cur else None)
        if (st["next"] is None and (cur is None or cur.after_id is None)) or planned != target:
            return False
    if when == "now":
        st = {"id": target, "seq": st["seq"] + 1, "next": None}
    elif when == "end":
        st["next"] = {"id": target}
    elif when == "cancel":
        st["next"] = None
    else:
        raise HTTPException(400, "when 只能是 now、end 或 cancel")
    _save_state(db, st)
    return True


# ---------------- 場合的內容 ----------------
def scene_content(s: WallScene | None) -> dict | None:
    """場合自己的「畫面放什麼」；None = 跟「內容」分頁一樣。"""
    if s is None or not s.content_json:
        return None
    try:
        data = json.loads(s.content_json)
    except ValueError:
        return None
    if not isinstance(data, dict):
        return None
    out = {k: data[k] for k in CONTENT_KEYS if isinstance(data.get(k), bool)}
    if data.get("mix") in WALL_MIXES:
        out["mix"] = data["mix"]
    return out or None


def effective_content(db: Session, scene: WallScene | None = None) -> dict:
    """大螢幕現在要放的內容：「內容」分頁的設定，現在的場合有自己的就蓋過去（註解、相簿還是照「內容」分頁）。"""
    content = wall_content(db)
    own = scene_content(scene)
    return {**content, **own} if own else content


def messages_on(db: Session) -> bool:
    """賓客能不能留言：「內容」分頁放留言，或現在的場合放留言。
    場合不放留言（例如進場只放照片）時照樣收：賓客可能正寫到一半，換到下一個場合就會上螢幕。"""
    return wall_content(db)["messages"] or effective_content(db, active(db))["messages"]


def effective_pace(db: Session, scene: WallScene | None = None) -> str:
    return (scene.pace if scene and scene.pace else "") or get_setting(db, WALL_PACE_KEY) or "normal"


def _song_ids(s: WallScene) -> list[int]:
    try:
        data = json.loads(s.song_ids or "[]")
    except ValueError:
        return []
    return [x for x in data if _int(x) is not None] if isinstance(data, list) else []


def _plates(s: WallScene) -> list[str]:
    return [x for x in (s.plates or "").split(",") if x]


def scenes(db: Session) -> list[WallScene]:
    return db.scalars(select(WallScene).order_by(WallScene.sort_order.asc(), WallScene.id.asc())).all()


def _song_set(db: Session) -> set[int]:
    return set(db.scalars(select(WallSong.id)).all())


def scene_out(s: WallScene, songs: set[int], ids: set[int]) -> dict:
    """後台用的：刪掉的歌、場合不列出來（存的資料不動，之後重新加回來也不會亂）。"""
    return {
        "id": s.id, "name": s.name, "sort_order": s.sort_order,
        "song_ids": [x for x in _song_ids(s) if x in songs], "shuffle": s.shuffle,
        "content": scene_content(s), "plates": _plates(s), "pace": s.pace, "theme": s.theme, "duck": s.duck,
        "after_id": s.after_id if s.after_id in ids and s.after_id != s.id else None,
    }


def feed_out(db: Session, s: WallScene) -> dict:
    """大螢幕用的：只給播放要的東西（畫面放什麼、節奏已經合併在 feed 的 content、pace 裡）。"""
    ids = set(db.scalars(select(WallScene.id)).all())
    songs = _song_set(db)
    return {
        "id": s.id, "name": s.name, "songs": [x for x in _song_ids(s) if x in songs], "shuffle": s.shuffle,
        "plates": _plates(s), "theme": s.theme, "duck": s.duck,
        "after": s.after_id if s.after_id in ids and s.after_id != s.id else None,
    }


def rev(db: Session) -> str:
    """場合的版本號：新增、修改、刪除都會變，手機遙控頁看到變了才重抓清單。"""
    count, max_id, last = db.execute(select(func.count(WallScene.id), func.max(WallScene.id), func.max(WallScene.updated_at))).one()
    return f"{count or 0}-{max_id or 0}-{last.isoformat() if hasattr(last, 'isoformat') else (last or '')}"


def list_out(db: Session) -> dict:
    rows = scenes(db)
    ids = {s.id for s in rows}
    songs = _song_set(db)
    return {"items": [scene_out(s, songs, ids) for s in rows], "active": state(db), "rev": rev(db)}


# ---------------- 新增、修改 ----------------
def clean_name(v) -> str:
    name = re.sub(r"\s+", " ", v if isinstance(v, str) else "").strip()
    if not name:
        raise HTTPException(400, "請幫這個場合取個名字，例如「新人進場」")
    if len(name) > NAME_MAX:
        raise HTTPException(400, f"場合名稱最多 {NAME_MAX} 個字")
    return name


def clean_content(v) -> str:
    """畫面放什麼：None = 跟「內容」分頁一樣；dict 要三樣都給（歌詞、留言、照片），照片比例可以不給。"""
    if v is None:
        return ""
    if not isinstance(v, dict) or any(not isinstance(v.get(k), bool) for k in CONTENT_KEYS):
        raise HTTPException(400, "畫面放什麼的格式不正確")
    out = {k: v[k] for k in CONTENT_KEYS}
    if v.get("mix") is not None:
        if v["mix"] not in WALL_MIXES:
            raise HTTPException(400, "照片與留言的比例只能是全放照片、照片多、一樣多或留言多")
        out["mix"] = v["mix"]
    return json.dumps(out)


def apply(db: Session, s: WallScene, data: dict) -> None:
    """套用後台送來的欄位（只改有給的）。歌、播完之後換到的場合都要是存在的。"""
    if "name" in data:
        s.name = clean_name(data["name"])
    if "song_ids" in data:
        ids = data["song_ids"]
        if not isinstance(ids, list) or any(_int(x) is None for x in ids):
            raise HTTPException(400, "歌的格式不正確")
        ids = list(dict.fromkeys(ids))
        if len(ids) > SONGS_MAX:
            raise HTTPException(400, f"一個場合最多 {SONGS_MAX} 首歌")
        if set(ids) - _song_set(db):
            raise HTTPException(400, "有歌已經不在歌單裡了，請重新整理再挑")
        s.song_ids = json.dumps(ids)
    if "shuffle" in data:
        s.shuffle = bool(data["shuffle"])
    if "content" in data:
        s.content_json = clean_content(data["content"])
    if "plates" in data:
        names = data["plates"]
        if not isinstance(names, list) or len(names) > PLATES_MAX or any(not isinstance(n, str) or not re.fullmatch(r"[a-z0-9]{1,40}", n) for n in names):
            raise HTTPException(400, "版面名稱格式不正確")
        s.plates = ",".join(dict.fromkeys(names))
    if "pace" in data:
        if data["pace"] not in ("", *PACES):
            raise HTTPException(400, "節奏只能是快、中、慢，或照「版面」分頁")
        s.pace = data["pace"]
    if "theme" in data:
        if data["theme"] not in ("", *THEMES):
            raise HTTPException(400, "沒有這個配色")
        s.theme = data["theme"]
    if "duck" in data:
        s.duck = bool(data["duck"])
    if "after_id" in data:
        aid = data["after_id"]
        if aid is not None:
            if _int(aid) is None or db.get(WallScene, aid) is None:
                raise HTTPException(400, "找不到播完之後要換到的場合")
            if aid == s.id:
                raise HTTPException(400, "播完之後要換到別的場合；想重複播這些歌就選「重複播」")
        s.after_id = aid


def next_order(db: Session) -> int:
    return (db.scalar(select(func.max(WallScene.sort_order))) or 0) + 1


def count(db: Session) -> int:
    return db.scalar(select(func.count(WallScene.id))) or 0


def check_room(db: Session, n: int = 1) -> None:
    if count(db) + n > MAX_SCENES:
        raise HTTPException(400, f"場合最多 {MAX_SCENES} 個")


def add_template(db: Session) -> list[WallScene]:
    """一次加入常見的流程。播完之後換到哪裡照名字接起來。"""
    tpl = TEMPLATE
    check_room(db, len(tpl))
    order = next_order(db)
    rows: dict[str, WallScene] = {}
    for i, t in enumerate(tpl):
        s = WallScene(name=t["name"], sort_order=order + i, duck=t.get("duck", False))
        db.add(s)
        rows[t["name"]] = s
    db.flush()
    for t in tpl:
        if t.get("after"):
            rows[t["name"]].after_id = rows[t["after"]].id
    return list(rows.values())


def forget(db: Session, scene_id: int) -> None:
    """刪掉一個場合之前：別的場合「播完之後換到它」的改成重複播；排好要換到它的取消。
    現在就是它的話回到沒有場合，但 seq 不加：大螢幕不重新開始，正在播的歌照樣播完、照原本的順序接下去。"""
    for s in db.scalars(select(WallScene).where(WallScene.after_id == scene_id)).all():
        s.after_id = None
    st = state(db)
    if st["id"] == scene_id:
        st["id"] = None
    if st["next"] and st["next"]["id"] == scene_id:
        st["next"] = None
    _save_state(db, st)
