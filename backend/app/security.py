"""後台登入驗證：用簽章 token（itsdangerous），不需資料庫。"""
from fastapi import Depends, Header, HTTPException, status
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from .config import settings

_serializer = URLSafeTimedSerializer(settings.secret_key, salt="admin-auth")
TOKEN_MAX_AGE = 7 * 24 * 3600  # token 有效 7 天


def create_token() -> str:
    return _serializer.dumps({"admin": True})


def verify_password(password: str) -> bool:
    return password == settings.admin_password


def require_admin(authorization: str | None = Header(default=None)) -> bool:
    """FastAPI 依賴：後台 API 需帶 Authorization: Bearer <token>。"""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "需要登入")
    token = authorization.split(" ", 1)[1].strip()
    try:
        _serializer.loads(token, max_age=TOKEN_MAX_AGE)
    except SignatureExpired:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "登入已過期，請重新登入")
    except BadSignature:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "登入無效")
    return True


AdminRequired = Depends(require_admin)
