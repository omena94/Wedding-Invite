"""登入驗證：用簽章 token（itsdangerous），不需資料庫。

兩種角色：
  couple  新人（完整權限：賓客、籌備、設定）
  helper  幫手（只能看賓客名單、報到相關）
"""
from fastapi import Depends, Header, HTTPException, status
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from .config import settings

_serializer = URLSafeTimedSerializer(settings.secret_key, salt="admin-auth")
TOKEN_MAX_AGE = 7 * 24 * 3600  # token 有效 7 天

ROLE_COUPLE = "couple"
ROLE_HELPER = "helper"


def create_token(role: str = ROLE_COUPLE) -> str:
    return _serializer.dumps({"admin": True, "role": role})


def login_role(password: str) -> str | None:
    """密碼對應到角色；不符合回傳 None。"""
    if password == settings.admin_password:
        return ROLE_COUPLE
    if settings.helper_password and password == settings.helper_password:
        return ROLE_HELPER
    return None


def verify_password(password: str) -> bool:
    return login_role(password) is not None


def _decode(authorization: str | None) -> dict:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "需要登入")
    token = authorization.split(" ", 1)[1].strip()
    try:
        data = _serializer.loads(token, max_age=TOKEN_MAX_AGE)
    except SignatureExpired:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "登入已過期，請重新登入")
    except BadSignature:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "登入無效")
    if not isinstance(data, dict) or not data.get("admin"):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "登入無效")
    # 舊版 token 沒有 role，視為新人
    data.setdefault("role", ROLE_COUPLE)
    return data


def require_staff(authorization: str | None = Header(default=None)) -> str:
    """新人或幫手皆可。回傳角色。"""
    return _decode(authorization)["role"]


def require_couple(authorization: str | None = Header(default=None)) -> str:
    """僅限新人。"""
    role = _decode(authorization)["role"]
    if role != ROLE_COUPLE:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "此功能僅限新人使用")
    return role


# 舊名稱維持相容（賓客相關 API 用）
require_admin = require_staff
AdminRequired = Depends(require_staff)
CoupleRequired = Depends(require_couple)
