"""內建的宴會廳範本：飯店提供的平面圖轉成座位圖物件，一鍵就能載入成一個新的廳。

兩個範本（都以飯店提供的平面圖為底圖，桌子、舞台、餐檯可移動，牆、柱、洗手間、投影布幕等固定物件鎖定）：
- 萬福廳（2026-09-10 飯店人員提供）：60×180 公分長桌兩張併成一段（120 寬），每段兩側各 3 張椅子，左側兩排各 4 段、右側三直排各 4 段，共 20 段 120 個座位。
  原圖 35 px = 一段 180 公分，所以 1 px ≈ 2.571 單位。
- 2 樓大宴會廳（2026-09-11 看完場地後決定使用）：自助餐 120＋2 位。舞台 9.6×3.6 公尺在正上方，中間飯店紅毯從大門通到主桌（2 位），
  紅毯兩側各 5 張長桌、每張兩側各 6 位共 12 位（左右各 60 位），兩側是自助餐檯區。原圖舞台 9.6 公尺 ≈ 116 px，所以 1 px ≈ 4.1 單位。
畫布 1 單位 = 2 公分（跟原本「美福 38×20 公尺」的比例一樣）。
"""
import shutil
import uuid
from pathlib import Path

from sqlalchemy.orm import Session

from .config import settings
from .models import SeatHall, SeatObject
from .seating import dump_meta

PRESET_DIR = Path(__file__).resolve().parent / "presets"

K = 2.571        # 萬福廳原圖每 px 幾個畫布單位
K_GRAND = 4.1    # 2 樓大宴會廳原圖每 px 幾個畫布單位


def _px(v: float, k: float = K) -> int:
    return round(v * k)


def _grid(v: float, k: float = K) -> int:
    """桌子的座標湊成 10 的倍數：編輯器拖曳會貼齊 10 單位的格線，不在格線上的桌子拖了就對不齊（2026-09-10）。"""
    return int(round(v * k / 10) * 10)


def _seg_h(label: str, x_px: float, y_px: float) -> dict:
    """萬福廳橫向的一段長桌（左側兩排）：上 3 下 3。"""
    return {"kind": "rect", "label": label, "x": _grid(x_px), "y": _grid(y_px), "w": 90, "h": 60, "seats": 6,
            "meta": {"sides": {"top": 3, "bottom": 3, "left": 0, "right": 0}}}


def _seg_v(label: str, x_px: float, y_px: float) -> dict:
    """萬福廳直向的一段長桌（右側三排）：左 3 右 3。"""
    return {"kind": "rect", "label": label, "x": _grid(x_px), "y": _grid(y_px), "w": 60, "h": 90, "seats": 6,
            "meta": {"sides": {"top": 0, "bottom": 0, "left": 3, "right": 3}}}


def _zone(label: str, x_px, y_px, w_px, h_px, blocked=True, kind="zone", k: float = K) -> dict:
    return {"kind": kind, "label": label, "x": _px(x_px, k), "y": _px(y_px, k), "w": max(20, _px(w_px, k)), "h": max(20, _px(h_px, k)),
            "seats": 0, "z_order": -1, "meta": {"blocked": True} if blocked and kind == "zone" else {}}


def _wall(x_px, y_px, w_px, h_px, k: float = K) -> dict:
    return {"kind": "wall", "label": "", "x": _px(x_px, k), "y": _px(y_px, k), "w": max(10, _px(w_px, k)), "h": max(10, _px(h_px, k)), "seats": 0, "meta": {}}


def _column(cx_px, cy_px, size_px=30, k: float = K) -> dict:
    s = _px(size_px, k)
    return {"kind": "column", "label": "", "x": _px(cx_px, k) - s // 2, "y": _px(cy_px, k) - s // 2, "w": s, "h": s, "seats": 0, "meta": {}}


def _label(text: str, x_px, y_px, w_px=45, h_px=12, k: float = K) -> dict:
    return {"kind": "label", "label": text, "x": _px(x_px, k), "y": _px(y_px, k), "w": _px(w_px, k), "h": _px(h_px, k), "seats": 0, "meta": {}}


def _entrance(label: str, cx_px, cy_px, rotation=0, k: float = K) -> dict:
    return {"kind": "entrance", "label": label, "x": _px(cx_px, k) - 75, "y": _px(cy_px, k) - 28, "w": 150, "h": 56,
            "rotation": rotation, "seats": 0, "z_order": -1, "meta": {}}


def _lock(items: list[dict]) -> list[dict]:
    """標成固定物件：meta.locked（編輯器不能拖、不能改大小、不能刪）與 meta.fixture（重新放回時認得出來），墊在最底層。"""
    for o in items:
        o["meta"] = {**o.get("meta", {}), "locked": True, "fixture": True}
        o["z_order"] = -2
    return items


# =====================================================================
# 萬福廳
# =====================================================================
def wanfu_fixtures() -> list[dict]:
    """萬福廳的固定物件（2026-09-11 新人要求寫死不能移動）：外牆、洗手間、禮盒區的牆、柱子、陽台門、出餐口。"""
    out: list[dict] = []
    # 外牆四面（南側：吧檯區的牆到洗手間西牆，再由禮盒區接到右下走道）
    out.append(_wall(28, 17, 516, 4))
    out.append(_wall(28, 17, 4, 383))
    out.append(_wall(543, 17, 4, 383))
    out.append(_wall(28, 349, 199, 4))
    # 洗手間兩間：四面牆（門口留在原圖的位置：第一間東側、第二間西側）
    for x0, x1, y0, y1 in ((227, 310, 262, 323), (345, 405, 264, 336)):
        out.append(_wall(x0, y0, x1 - x0, 4))
        out.append(_wall(x0, y1, x1 - x0, 4))
        out.append(_wall(x0, y0, 4, y1 - y0))
        out.append(_wall(x1, y0, 4, y1 - y0 + 4))
    # 禮盒區（收禮）：x 405～500、y 283～385（2026-09-11 依放大圖修正，原本 385～470 跟第二間洗手間重疊）
    # 北牆 405～480，480～500 是通往 candy bar 走道的門；西牆與洗手間東牆共用，y 362～385 是進廳的門；南牆 405～470，470～500 是大門
    out.append(_wall(405, 283, 75, 4))
    out.append(_wall(405, 336, 4, 26))
    out.append(_wall(405, 385, 65, 4))
    # 右下走道的南牆：門口以東到右外牆
    out.append(_wall(500, 283, 45, 4))
    # 柱子（原圖深灰色方塊）
    for cx, cy in ((40, 26), (163, 25), (283, 24), (405, 25), (525, 25), (35, 148), (528, 134), (42, 270), (520, 270), (40, 345), (520, 378)):
        out.append(_column(cx, cy))
    out.append(_column(282, 153, 31))
    # 不可通行的房間
    out.append(_zone("洗手間", 227, 262, 83, 61))
    out.append(_zone("洗手間", 345, 262, 60, 73))
    # 禮盒區是賓客從大門進來、經西側的門進廳的房間，要可通行（只靠四周的牆與門口擋路），入口放在裡面才算得出路線
    out.append(_zone("禮盒區（收禮）", 405, 283, 95, 102, blocked=False))
    # 陽台門（可通行的門，只是標示）、出餐口
    out.append(_zone("出陽台門", 70, 6, 30, 14, blocked=False))
    out.append(_zone("出陽台門", 413, 6, 30, 14, blocked=False))
    out.append(_label("出餐口", 192, 322, 35))
    return _lock(out)


def wanfu_objects() -> list[dict]:
    out: list[dict] = []
    # 左側兩排：A（上）B（下），每排 4 段，段寬 35 px 從 x=87 開始
    for i in range(4):
        out.append(_seg_h(f"A{i + 1}", 87 + 35 * i, 78))
        out.append(_seg_h(f"B{i + 1}", 87 + 35 * i, 210))
    # 右側三直排：C、D、E，每排 4 段，從 y=80 開始
    for col, x in (("C", 328), ("D", 379), ("E", 431)):
        for j in range(4):
            out.append(_seg_v(f"{col}{j + 1}", x, 80 + 35 * j))
    # 舞台（原圖上方正中的綠框區）與旁邊的布置
    out.append(_zone("舞台", 245, 68, 65, 52, kind="stage"))
    out.append(_zone("布置區", 222, 122, 33, 63, blocked=False))
    out.append(_zone("投影幕", 257, 125, 7, 55))
    out.append(_zone("keyboard 80×120", 270, 40, 25, 12, blocked=False))
    # 可移動的家具與區域
    out.append(_zone("吧檯", 65, 313, 85, 14))
    out.append(_zone("櫃台 360×240", 60, 120, 45, 70))
    out.append(_zone("投影", 365, 253, 55, 9))
    out.append(_zone("candy bar", 532, 222, 15, 50, blocked=False))
    # 固定物件（牆、柱、洗手間、禮盒區、陽台門、出餐口）
    out.extend(wanfu_fixtures())
    # 入口：賓客從右下大門進到禮盒區，再由禮盒區西側的門進廳；也可以走 candy bar 那條走道
    out.append(_entrance("入口（禮盒區）", 373, 362, rotation=90))
    out.append(_entrance("入口（candy bar）", 485, 268))
    return out


# =====================================================================
# 2 樓大宴會廳（2026-09-11）
# =====================================================================
G = K_GRAND


def _grand_table(label: str, x0: float, x1: float, y0: float, y1: float) -> dict:
    """紅毯兩側的長桌：一張桌子（原圖是兩張併成一列）兩側各 6 位共 12 位，直向擺。"""
    return {"kind": "rect", "label": label, "x": _grid(x0, G), "y": _grid(y0, G), "w": _px(x1 - x0, G), "h": _px(y1 - y0, G), "seats": 12,
            "meta": {"sides": {"top": 0, "bottom": 0, "left": 6, "right": 6}}}


def grand_fixtures() -> list[dict]:
    """2 樓大宴會廳的固定物件：宴會廳四面牆（門口留缺口）、兩側投影布幕。原圖沒有畫柱子。"""
    out: list[dict] = []
    # 北牆 y≈73：兩扇門在 x 300～320、500～520
    out.append(_wall(197, 71, 103, 4, G))
    out.append(_wall(320, 71, 180, 4, G))
    out.append(_wall(520, 71, 166, 4, G))
    # 南牆 y≈325：門口 250～270、347～367、393～450（大門，紅毯從這裡進來）、465～490、573～593、633～647
    for x0, x1 in ((197, 250), (270, 347), (367, 393), (450, 465), (490, 573), (593, 633), (647, 686)):
        out.append(_wall(x0, 323, x1 - x0, 4, G))
    # 東西牆 x≈197、686：兩側 y 175～235 是通往側廳（投影布幕）的開口，留缺口
    out.append(_wall(197, 71, 4, 104, G))
    out.append(_wall(197, 235, 4, 92, G))
    out.append(_wall(686, 71, 4, 104, G))
    out.append(_wall(686, 235, 4, 92, G))
    # 兩側投影布幕（側廳裡，不可通行）
    out.append(_zone("投影布幕", 185, 175, 10, 60, k=G))
    out.append(_zone("投影布幕", 690, 175, 10, 60, k=G))
    return _lock(out)


def grand_objects() -> list[dict]:
    out: list[dict] = []
    # 紅毯左側 A1～A5、右側 B1～B5（各 12 位）：從靠紅毯的那排開始編
    out.append(_grand_table("A1", 361, 381, 161, 229))
    out.append(_grand_table("A2", 361, 381, 241, 309))
    out.append(_grand_table("A3", 313, 333, 147, 215))
    out.append(_grand_table("A4", 313, 333, 230, 298))
    out.append(_grand_table("A5", 266, 286, 184, 252))
    out.append(_grand_table("B1", 461, 481, 161, 229))
    out.append(_grand_table("B2", 461, 481, 241, 309))
    out.append(_grand_table("B3", 502, 522, 145, 213))
    out.append(_grand_table("B4", 502, 522, 236, 304))
    out.append(_grand_table("B5", 546, 566, 189, 257))
    # 主桌：紅毯盡頭的小桌，新人兩位，椅子朝舞台那側
    out.append({"kind": "rect", "label": "主桌", "x": _grid(410, G), "y": _grid(152, G), "w": _px(30, G), "h": _px(26, G), "seats": 2,
                "meta": {"sides": {"top": 2, "bottom": 0, "left": 0, "right": 0}}})
    # 舞台 9.6×3.6 公尺、LED 牆、音控區
    out.append(_zone("舞台 9.6×3.6m", 360, 78, 116, 48, kind="stage", k=G))
    out.append(_zone("420 吋 LED", 360, 70, 116, 6, k=G))
    out.append(_zone("音控區", 478, 82, 34, 28, k=G))
    # 飯店紅毯（可通行）、自助餐檯區、接待桌、迎賓雞尾酒區、迎賓背板
    out.append(_zone("飯店紅毯", 415, 178, 21, 150, blocked=False, k=G))
    out.append(_zone("自助餐檯區", 208, 112, 48, 186, k=G))
    out.append(_zone("自助餐檯區", 592, 112, 48, 186, k=G))
    out.append(_zone("接待桌", 300, 340, 60, 12, k=G))
    out.append(_zone("迎賓雞尾酒區", 285, 400, 95, 20, blocked=False, k=G))
    out.append(_label("飯店迎賓背板", 450, 358, 80, 14, k=G))
    out.extend(grand_fixtures())
    # 入口：大門在南牆正中央，紅毯從這裡進來
    out.append(_entrance("入口（大門）", 421, 340, k=G))
    return out


PRESETS = {
    "wanfu": {
        "name": "萬福廳",
        "w": _px(599),
        "h": _px(410),
        "clearance": 12,
        "image": "wanfu.jpg",
        "objects": wanfu_objects,
        "fixtures": wanfu_fixtures,
        "summary": "20 段長桌（每段兩側各 3 位，共 120 個座位）、舞台、入口、洗手間等",
    },
    "grand": {
        "name": "2 樓大宴會廳",
        "w": _px(796, G),
        "h": _px(511, G),
        "clearance": 12,
        "image": "grand.jpg",
        "objects": grand_objects,
        "fixtures": grand_fixtures,
        "summary": "紅毯兩側各 5 張長桌（每張 12 位，共 120 位）加主桌 2 位、舞台、自助餐檯、大門入口等",
    },
}


def preset_list() -> list[dict]:
    return [{"key": k, "name": p["name"], "summary": p["summary"]} for k, p in PRESETS.items()]


def install_fixtures(db: Session, hall: SeatHall, key: str) -> int:
    """把範本的固定物件放回某一廳：先清掉這一廳裡舊的固定物件（標了 fixture 的、所有牆與柱、以及跟範本固定物件同名的區域／文字），
    再放進鎖定版。桌椅、舞台、餐檯、入口與座位安排都不動。回傳放進去的數量。"""
    preset = PRESETS[key]
    specs = preset["fixtures"]()
    fixture_labels = {s["label"] for s in specs if s["kind"] in ("zone", "label") and s.get("label")}
    for o in list(db.query(SeatObject).filter(SeatObject.hall_id == hall.id).all()):
        meta = o.meta
        if meta.get("fixture") or o.kind in ("wall", "column") or (o.kind in ("zone", "label") and o.label in fixture_labels):
            db.delete(o)
    db.flush()
    for spec in specs:
        meta = spec.pop("meta", {})
        db.add(SeatObject(hall_id=hall.id, meta_json=dump_meta(meta), **spec))
    hall.preset_key = key
    db.commit()
    return len(specs)


def install_preset(db: Session, key: str) -> SeatHall:
    """建一個新的廳，放進範本的桌椅，並把飯店平面圖複製到 uploads 當底圖。不會動到其他廳。"""
    preset = PRESETS[key]
    hall = SeatHall(name=preset["name"], canvas_w=preset["w"], canvas_h=preset["h"], clearance=preset["clearance"], is_active=False, preset_key=key)
    src = PRESET_DIR / preset["image"]
    if src.is_file():
        stored = f"hallbg_{uuid.uuid4().hex}{src.suffix.lower()}"
        shutil.copyfile(src, settings.upload_path / stored)
        hall.bg_image = stored
    db.add(hall)
    db.flush()
    for spec in preset["objects"]():
        meta = spec.pop("meta", {})
        db.add(SeatObject(hall_id=hall.id, meta_json=dump_meta(meta), **spec))
    db.commit()
    return hall
