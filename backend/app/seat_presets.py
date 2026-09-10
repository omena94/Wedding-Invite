"""內建的宴會廳範本：飯店提供的平面圖轉成座位圖物件，一鍵就能載入成一個新的廳。

目前只有「萬福廳」（2026-09-10 飯店人員提供的平面圖，原圖放在 presets/wanfu.jpg，載入時會當底圖）。
平面圖上的桌子是 60×180 公分長桌兩張併成一段（120 寬），每段兩側各 3 張椅子，也就是新人說的「3×3 一單位」：
左側兩排各 4 段、右側三直排各 4 段，共 20 段 120 個座位。
座標換算：畫布 1 單位 = 2 公分（跟原本「美福 38×20 公尺」的比例一樣）；原圖 35 px = 一段 180 公分，所以 1 px ≈ 2.571 單位。
"""
import shutil
import uuid
from pathlib import Path

from sqlalchemy.orm import Session

from .config import settings
from .models import SeatHall, SeatObject
from .seating import dump_meta

PRESET_DIR = Path(__file__).resolve().parent / "presets"

K = 2.571  # 原圖每 px 幾個畫布單位


def _px(v: float) -> int:
    return round(v * K)


def _grid(v: float) -> int:
    """桌子的座標湊成 10 的倍數：編輯器拖曳會貼齊 10 單位的格線，不在格線上的桌子拖了就對不齊（2026-09-10）。"""
    return int(round(v * K / 10) * 10)


def _seg_h(label: str, x_px: float, y_px: float) -> dict:
    """橫向的一段長桌（左側兩排）：上 3 下 3。"""
    return {"kind": "rect", "label": label, "x": _grid(x_px), "y": _grid(y_px), "w": 90, "h": 60, "seats": 6,
            "meta": {"sides": {"top": 3, "bottom": 3, "left": 0, "right": 0}}}


def _seg_v(label: str, x_px: float, y_px: float) -> dict:
    """直向的一段長桌（右側三排）：左 3 右 3。"""
    return {"kind": "rect", "label": label, "x": _grid(x_px), "y": _grid(y_px), "w": 60, "h": 90, "seats": 6,
            "meta": {"sides": {"top": 0, "bottom": 0, "left": 3, "right": 3}}}


def _zone(label: str, x_px, y_px, w_px, h_px, blocked=True, kind="zone") -> dict:
    return {"kind": kind, "label": label, "x": _px(x_px), "y": _px(y_px), "w": max(20, _px(w_px)), "h": max(20, _px(h_px)),
            "seats": 0, "z_order": -1, "meta": {"blocked": True} if blocked and kind == "zone" else {}}


def _wall(x_px, y_px, w_px, h_px) -> dict:
    return {"kind": "wall", "label": "", "x": _px(x_px), "y": _px(y_px), "w": max(10, _px(w_px)), "h": max(10, _px(h_px)), "seats": 0, "meta": {}}


def _column(cx_px, cy_px, size_px=30) -> dict:
    s = _px(size_px)
    return {"kind": "column", "label": "", "x": _px(cx_px) - s // 2, "y": _px(cy_px) - s // 2, "w": s, "h": s, "seats": 0, "meta": {}}


def _label(text: str, x_px, y_px, w_px=45, h_px=12) -> dict:
    return {"kind": "label", "label": text, "x": _px(x_px), "y": _px(y_px), "w": _px(w_px), "h": _px(h_px), "seats": 0, "meta": {}}


def _entrance(label: str, cx_px, cy_px, rotation=0) -> dict:
    return {"kind": "entrance", "label": label, "x": _px(cx_px) - 75, "y": _px(cy_px) - 28, "w": 150, "h": 56,
            "rotation": rotation, "seats": 0, "z_order": -1, "meta": {}}


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
    out.append(_column(282, 153, 31))
    out.append(_zone("keyboard 80×120", 270, 40, 25, 12, blocked=False))
    # 牆面：外牆三面 + 南側（吧檯區）+ 洗手間西牆 + 右下走道南牆
    out.append(_wall(28, 17, 516, 4))
    out.append(_wall(28, 17, 4, 383))
    out.append(_wall(543, 17, 4, 383))
    out.append(_wall(28, 349, 199, 4))
    out.append(_wall(227, 262, 4, 88))
    out.append(_wall(470, 283, 75, 4))
    # 柱子（原圖深灰色方塊）
    for cx, cy in ((40, 26), (163, 25), (283, 24), (405, 25), (525, 25), (35, 148), (528, 134), (42, 270), (520, 270), (40, 345), (520, 378)):
        out.append(_column(cx, cy))
    # 不可通行的區域
    out.append(_zone("洗手間", 227, 262, 83, 61))
    out.append(_zone("洗手間", 345, 262, 60, 73))
    out.append(_zone("禮盒區（收禮）", 385, 283, 85, 102))
    out.append(_zone("吧檯", 65, 313, 85, 14))
    out.append(_zone("櫃台 360×240", 60, 120, 45, 70))
    out.append(_zone("投影", 365, 253, 55, 9))
    out.append(_zone("candy bar", 532, 222, 15, 50, blocked=False))
    # 文字
    out.append(_label("出陽台門", 68, 22))
    out.append(_label("出陽台門", 412, 22))
    out.append(_label("出餐口", 192, 322, 35))
    # 入口：賓客從右下大門進到禮盒區，再由禮盒區西側的門進廳；也可以走 candy bar 那條走道
    out.append(_entrance("入口（禮盒區）", 373, 362, rotation=90))
    out.append(_entrance("入口（candy bar）", 485, 268))
    return out


PRESETS = {
    "wanfu": {
        "name": "萬福廳",
        "w": _px(599),
        "h": _px(410),
        "clearance": 12,
        "image": "wanfu.jpg",
        "objects": wanfu_objects,
    },
}


def install_preset(db: Session, key: str) -> SeatHall:
    """建一個新的廳，放進範本的桌椅，並把飯店平面圖複製到 uploads 當底圖。不會動到其他廳。"""
    preset = PRESETS[key]
    hall = SeatHall(name=preset["name"], canvas_w=preset["w"], canvas_h=preset["h"], clearance=preset["clearance"], is_active=False)
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
