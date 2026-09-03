"""Gmail SMTP 寄信：後台群發通知用。

- 單封測試信：同步寄送，立即回報成功/失敗。
- 群發：背景執行緒逐封寄送（每封間隔 0.6 秒），完成後把結果推到 Telegram 群組。
- 內文與主旨支援 {name} 佔位符，會替換成每位賓客的姓名。
"""
import logging
import smtplib
import threading
import time
from email.header import Header
from email.mime.text import MIMEText
from email.utils import formataddr

from .config import settings
from .notify import send_telegram

log = logging.getLogger("mailer")


def smtp_ready() -> bool:
    return bool(settings.smtp_user and settings.smtp_password)


def _build_message(to: str, subject: str, body: str) -> str:
    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = str(Header(subject, "utf-8"))
    msg["From"] = formataddr((settings.smtp_from_name, settings.smtp_user))
    msg["To"] = to
    return msg.as_string()


def send_one(to: str, subject: str, body: str) -> None:
    """同步寄一封（測試信用），失敗會拋例外。"""
    with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=30) as s:
        s.login(settings.smtp_user, settings.smtp_password)
        s.sendmail(settings.smtp_user, [to], _build_message(to, subject, body))


def _broadcast_worker(recipients: list[tuple[str, str]], subject: str, body: str) -> None:
    ok = 0
    failed: list[str] = []
    try:
        with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=30) as s:
            s.login(settings.smtp_user, settings.smtp_password)
            for name, email in recipients:
                try:
                    s.sendmail(
                        settings.smtp_user,
                        [email],
                        _build_message(
                            email,
                            subject.replace("{name}", name),
                            body.replace("{name}", name),
                        ),
                    )
                    ok += 1
                except Exception as e:
                    log.warning("寄給 %s <%s> 失敗：%s", name, email, e)
                    failed.append(name)
                time.sleep(0.6)  # 溫和的間隔，避免被 Gmail 當成濫發
    except Exception as e:
        log.error("群發中斷：%s", e)
        send_telegram(f"📣 群發通知中斷（已寄 {ok} 封）：{e}")
        return

    text = f"📣 <b>群發通知完成</b>\n✅ 成功 {ok} 封"
    if failed:
        text += f"\n❌ 失敗 {len(failed)} 封：{'、'.join(failed)}"
    send_telegram(text)


def broadcast(recipients: list[tuple[str, str]], subject: str, body: str) -> None:
    """背景群發，立即返回。"""
    threading.Thread(
        target=_broadcast_worker, args=(recipients, subject, body), daemon=True
    ).start()
