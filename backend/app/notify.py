"""Telegram 通知：賓客送出回覆時推播到群組。

設計為 fire-and-forget（背景執行緒送出、逾時 10 秒、任何錯誤只記 log），
Telegram 掛掉也不影響賓客送出表單。
"""
import html
import json
import logging
import threading
import urllib.request

from .config import settings

log = logging.getLogger("notify")

SIDE_TXT = {"groom": "男方", "bride": "女方"}


def _post(text: str) -> None:
    try:
        url = f"https://api.telegram.org/bot{settings.telegram_bot_token}/sendMessage"
        data = json.dumps({
            "chat_id": settings.telegram_chat_id,
            "text": text,
            "parse_mode": "HTML",
            "disable_web_page_preview": True,
        }).encode()
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = json.load(resp)
            if not body.get("ok"):
                log.warning("Telegram 回應異常：%s", body)
    except Exception as e:
        log.warning("Telegram 通知失敗：%s", e)


def send_telegram(text: str) -> None:
    """背景送出，不阻塞 API 回應。未設定 token 時直接略過。"""
    if not settings.telegram_bot_token or not settings.telegram_chat_id:
        return
    threading.Thread(target=_post, args=(text,), daemon=True).start()


def esc(s: str) -> str:
    return html.escape(str(s or ""))


def phase1_message(record, attending_groups: int, total_guests: int) -> str:
    """Phase 1 意願調查通知。"""
    name = esc(record.name)
    side = SIDE_TXT.get(record.side, record.side)
    if record.attending:
        lines = [
            "🎉 <b>新的出席回覆！</b>",
            f"👤 {name}（{side}親友）",
            f"👥 大人 {record.adult_count}・小孩 {record.child_count}",
        ]
        contact = "・".join(x for x in [esc(record.phone), esc(record.email)] if x)
        if contact:
            lines.append(f"📞 {contact}")
    else:
        lines = [
            "🕊 收到一筆「不克前往」回覆",
            f"👤 {name}（{side}親友）",
        ]
    if record.message:
        lines.append(f"💬 {esc(record.message)}")
    lines.append("─────")
    lines.append(f"📊 累計：出席 {attending_groups} 組・共 {total_guests} 人")
    return "\n".join(lines)


def phase2_message(record, details_done: int, attending_groups: int) -> str:
    """Phase 2 詳細調查通知。"""
    lines = [
        "🍽 <b>詳細資料已完成</b>",
        f"👤 {esc(record.name)}（{SIDE_TXT.get(record.side, record.side)}親友）",
        f"👥 確認人數：大人 {record.adult_count}・小孩 {record.child_count}",
    ]
    mains = record.main_course
    if mains:
        lines.append("🥩 主餐：" + "、".join(f"{esc(k)}×{v}" for k, v in mains.items()))
    extras = []
    if record.kids_meal_count:
        extras.append(f"兒童餐 {record.kids_meal_count}")
    if record.baby_chair_count:
        extras.append(f"兒童座椅 {record.baby_chair_count}")
    if extras:
        lines.append("🧸 " + "・".join(extras))
    if record.dietary_note:
        lines.append(f"⚠️ 飲食備註:{esc(record.dietary_note)}")
    if record.remark:
        lines.append(f"📝 備註：{esc(record.remark)}")
    lines.append("─────")
    lines.append(f"📊 詳細填寫進度：{details_done} / {attending_groups} 組")
    return "\n".join(lines)
