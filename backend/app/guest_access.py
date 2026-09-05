"""回覆收據與 Email 驗證碼；只有完成驗證的賓客能讀取、更新詳細資料。"""
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta

from fastapi import HTTPException
from itsdangerous import BadData, URLSafeTimedSerializer
from sqlalchemy import delete, func, select

from .config import settings
from .models import GuestVerification


def signer():
    return URLSafeTimedSerializer(settings.secret_key, salt="guest-rsvp-access-v1")


def access_token(record, receipt=False):
    return signer().dumps({"guest": record.public_id, "purpose": "receipt" if receipt else "edit"})


def token_guest(token):
    try:
        data = signer().loads(token, max_age=90 * 86400)
        if data.get("purpose") != "receipt":
            data = signer().loads(token, max_age=1800)
        if data.get("purpose") not in ("receipt", "edit") or not data.get("guest"):
            raise ValueError()
        return data["guest"]
    except (BadData, ValueError, TypeError, AttributeError):
        raise HTTPException(401, "回覆連結已失效，請重新取得驗證碼")


def digest(value):
    return hmac.new(settings.secret_key.encode(), value.encode(), hashlib.sha256).hexdigest()


def new_challenge(db, record, ip):
    now = datetime.utcnow()
    db.execute(delete(GuestVerification).where(GuestVerification.expires_at < now - timedelta(days=1)))
    ip_hash = digest(ip)
    count = db.scalar(select(func.count()).select_from(GuestVerification).where(GuestVerification.ip_hash == ip_hash, GuestVerification.created_at > now - timedelta(minutes=15))) or 0
    recent = db.scalar(select(func.count()).select_from(GuestVerification).where(GuestVerification.rsvp_id == record.id, GuestVerification.created_at > now - timedelta(seconds=60))) or 0
    if count >= 10 or recent:
        raise HTTPException(429, "驗證碼剛剛已寄出，請稍等一分鐘再試")
    code = f"{secrets.randbelow(1000000):06d}"
    challenge = GuestVerification(id=secrets.token_urlsafe(24), rsvp_id=record.id, ip_hash=ip_hash, created_at=now, expires_at=now + timedelta(minutes=10), attempts=0)
    challenge.code_hash = digest(challenge.id + ":" + code)
    db.add(challenge)
    db.commit()
    return challenge, code


def verify_challenge(db, challenge_id, code):
    # 鎖定同一筆驗證，避免平行請求繞過次數限制或重複使用。
    row = db.scalars(select(GuestVerification).where(GuestVerification.id == challenge_id).with_for_update()).first()
    if not row or row.expires_at <= datetime.utcnow() or row.attempts >= 5 or row.used:
        raise HTTPException(400, "驗證碼已失效，請重新取得")
    row.attempts += 1
    valid = hmac.compare_digest(row.code_hash, digest(row.id + ":" + code))
    if valid:
        row.used = True
    db.commit()
    if not valid:
        raise HTTPException(400, "驗證碼不正確，請再確認信件內容")
    return row.rsvp_id
