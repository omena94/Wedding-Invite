"""大螢幕的場合（app/wall_scenes.py）：新人在後台新增、改名、排順序、挑歌；婚禮當天用手機遙控切換。

鑰匙跟歌單一樣分兩把：場合的設定（挑歌、版面、配色）要 wall_setup，婚禮前新人做；
切換要 wall（當天操作），幫手只有手機遙控也能切。「畫面放什麼」兩把都能改（跟「內容」分頁一樣，當天也會臨時調）。
"""
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, StrictBool, StrictInt, StrictStr
from sqlalchemy.orm import Session

from .. import wall_scenes
from ..database import get_db
from ..models import WallScene
from .wall import Either, Perm, Setup, _feed_changed, _publish_state

router = APIRouter(tags=["wall"])
BASE = "/api/planner/wall/scenes"


def _changed(db: Session) -> None:
    """場合改了：大螢幕馬上抓 feed（現在的場合可能就是改的這個），手機遙控頁更新場合清單。"""
    _feed_changed()
    _publish_state(db)


def _get(db: Session, scene_id: int) -> WallScene:
    s = db.get(WallScene, scene_id)
    if not s:
        raise HTTPException(404, "找不到這個場合")
    return s


@router.get(BASE, dependencies=[Either])
def list_scenes(db: Session = Depends(get_db)):
    return wall_scenes.list_out(db)


class SceneIn(BaseModel):
    # 只改有給的欄位；content、after_id 給 null 是「跟原本的設定一樣／重複播」
    name: Any = None
    song_ids: Any = None
    shuffle: StrictBool | None = None
    content: Any = None
    plates: Any = None
    pace: StrictStr | None = None
    theme: StrictStr | None = None
    duck: StrictBool | None = None
    after_id: Any = None


def _data(payload: SceneIn) -> dict:
    # exclude_unset：沒給的不動，明確給 null 的才清掉
    return payload.model_dump(exclude_unset=True)


@router.post(BASE, status_code=201, dependencies=[Setup])
def create_scene(payload: SceneIn, db: Session = Depends(get_db)):
    data = _data(payload)
    wall_scenes.check_room(db)
    s = WallScene(name=wall_scenes.clean_name(data.get("name")), sort_order=wall_scenes.next_order(db))
    db.add(s)
    db.flush()
    wall_scenes.apply(db, s, data)
    db.commit()
    _changed(db)
    return wall_scenes.list_out(db)


@router.post(f"{BASE}/template", status_code=201, dependencies=[Setup])
def add_template(db: Session = Depends(get_db)):
    """一次加入常見的流程（迎賓、進場、致詞、用餐、二次進場、敬酒、送客）。"""
    wall_scenes.add_template(db)
    db.commit()
    _changed(db)
    return wall_scenes.list_out(db)


@router.patch(f"{BASE}/{{scene_id}}", dependencies=[Setup])
def update_scene(scene_id: int, payload: SceneIn, db: Session = Depends(get_db)):
    s = _get(db, scene_id)
    wall_scenes.apply(db, s, _data(payload))
    db.commit()
    _changed(db)
    return wall_scenes.list_out(db)


class ContentIn(BaseModel):
    content: dict | None


@router.put(f"{BASE}/{{scene_id}}/content", dependencies=[Either])
def set_scene_content(scene_id: int, payload: ContentIn, db: Session = Depends(get_db)):
    """只改「畫面放什麼」：手機遙控在這個場合臨時切組合用，所以當天的鑰匙也能改（不能動歌與版面）。"""
    s = _get(db, scene_id)
    s.content_json = wall_scenes.clean_content(payload.content)
    db.commit()
    _changed(db)
    return wall_scenes.list_out(db)


class ReorderIn(BaseModel):
    ids: list[StrictInt]


@router.post(f"{BASE}/reorder", dependencies=[Setup])
def reorder_scenes(payload: ReorderIn, db: Session = Depends(get_db)):
    rows = {s.id: s for s in wall_scenes.scenes(db)}
    if sorted(payload.ids) != sorted(rows):
        raise HTTPException(400, "場合清單已經變了，請重新整理再排")
    for i, sid in enumerate(payload.ids):
        rows[sid].sort_order = i + 1
    db.commit()
    _changed(db)
    return wall_scenes.list_out(db)


@router.delete(f"{BASE}/{{scene_id}}", dependencies=[Setup])
def delete_scene(scene_id: int, db: Session = Depends(get_db)):
    s = _get(db, scene_id)
    wall_scenes.forget(db, s.id)
    db.delete(s)
    db.commit()
    _changed(db)
    return wall_scenes.list_out(db)


class SwitchIn(BaseModel):
    id: StrictInt | None = None       # 要換到的場合；None = 不指定場合（照整份歌單播）
    when: StrictStr = "now"           # now 馬上換／end 這首播完再換／cancel 取消排好的
    # 大螢幕在歌播完時來換才帶：它看到的狀態（場合、切換編號），跟伺服器不一樣就不換（中間有人用手機切過了）
    expect_from: StrictInt | None = None
    expect_seq: StrictInt | None = None


@router.post(f"{BASE}/switch", dependencies=[Perm])
def switch_scene(payload: SwitchIn, db: Session = Depends(get_db)):
    expect = {"from": payload.expect_from, "seq": payload.expect_seq} if payload.expect_seq is not None else None
    applied = wall_scenes.switch(db, payload.id, payload.when, expect)
    db.commit()
    if applied:
        _changed(db)
    return {"applied": applied, "active": wall_scenes.state(db)}
